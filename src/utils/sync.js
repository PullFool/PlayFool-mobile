// Cloud sync — phone and PC share a "sync code" and exchange songs through a
// Cloudflare R2-backed Worker. Files are deleted from the relay as soon as the
// receiver confirms. Local diff uses filename+size to avoid re-transferring
// the same song.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { reportError } from './errorReporter';

const RELAY_URL = 'https://playfool-sync.playfool-sync.workers.dev';
const PAIR_KEY = 'playfool_mobile_sync_pair';
const ALBUM_NAME = 'PlayFool';

export async function getPairing() {
  try {
    const raw = await AsyncStorage.getItem(PAIR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export async function setPairing(pair) {
  try {
    if (pair) await AsyncStorage.setItem(PAIR_KEY, JSON.stringify(pair));
    else await AsyncStorage.removeItem(PAIR_KEY);
  } catch (e) {}
}

function normalizeCode(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

async function fetchJson(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
    return res.json();
  } finally { clearTimeout(timer); }
}

// Confirm the relay is reachable and the code is valid format.
export async function pairWith(code) {
  const c = normalizeCode(code);
  if (c.length < 4) throw new Error('Sync code must be at least 4 characters');
  // Touch the relay's list endpoint to fail fast if internet is down.
  await fetchJson(`${RELAY_URL}/v1/list?code=${encodeURIComponent(c)}`);
  const pair = { code: c, base: RELAY_URL, name: 'PlayFool Cloud', pairedAt: Date.now() };
  await setPairing(pair);
  return pair;
}

async function listLocal() {
  const out = [];
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) return out;
  const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
  if (!album) return out;
  let endCursor;
  let hasNextPage = true;
  while (hasNextPage) {
    const page = await MediaLibrary.getAssetsAsync({
      album: album.id,
      mediaType: MediaLibrary.MediaType.audio,
      first: 200,
      after: endCursor,
    });
    for (const asset of page.assets) {
      const info = await MediaLibrary.getAssetInfoAsync(asset).catch(() => null);
      const localUri = info?.localUri || asset.uri;
      let size = 0;
      try {
        const stat = await FileSystem.getInfoAsync(localUri, { size: true });
        size = stat?.size || 0;
      } catch (e) {}
      out.push({ name: asset.filename, size, uri: localUri, assetId: asset.id });
    }
    endCursor = page.endCursor;
    hasNextPage = page.hasNextPage;
  }
  return out;
}

async function listCloud(pair) {
  const data = await fetchJson(`${pair.base}/v1/list?code=${encodeURIComponent(pair.code)}`);
  return data.files || [];
}

// Match songs by base name (extension stripped, normalized) so the same
// song stored as .mp3 on one device and .m4a on another isn't duplicated.
function songKey(name) {
  if (!name) return '';
  return String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Diff: cloud-only → toDownload; local-only → toUpload. Match by song name.
export async function planSync(pair) {
  const cloud = await listCloud(pair);
  const local = await listLocal();
  const localSet = new Set(local.map((f) => songKey(f.name)));
  const cloudSet = new Set(cloud.map((f) => songKey(f.name)));
  const toDownload = cloud.filter((f) => !localSet.has(songKey(f.name)));
  const toUpload = local.filter((f) => !cloudSet.has(songKey(f.name)));
  return { cloud, local, toDownload, toUpload };
}

async function downloadOne(pair, file, onBytes) {
  const tempDir = FileSystem.cacheDirectory + 'PlayFool-sync/';
  await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => {});
  const tempUri = tempDir + file.name;
  const url = `${pair.base}/v1/file/${file.id}?code=${encodeURIComponent(pair.code)}`;
  const dl = FileSystem.createDownloadResumable(url, tempUri, {}, (snap) => {
    if (onBytes) onBytes(snap.totalBytesWritten, snap.totalBytesExpectedToWrite);
  });
  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');
  const asset = await MediaLibrary.createAssetAsync(result.uri);
  try {
    let album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
    if (!album) album = await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
    else await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
  } catch (e) {}
  try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch (e) {}
  // Tell the relay it's safe to delete the cloud copy.
  try {
    await fetch(`${pair.base}/v1/confirm?code=${encodeURIComponent(pair.code)}&id=${encodeURIComponent(file.id)}`, { method: 'POST' });
  } catch (e) {}
  return asset;
}

async function uploadOne(pair, file, onBytes) {
  const url = `${pair.base}/v1/upload?code=${encodeURIComponent(pair.code)}&name=${encodeURIComponent(file.name)}&size=${file.size}`;
  const task = FileSystem.createUploadTask(
    url,
    file.uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'application/octet-stream' },
    },
    (snap) => {
      if (onBytes) onBytes(snap.totalByteSent, snap.totalBytesExpectedToSend);
    }
  );
  const result = await task.uploadAsync();
  if (result.status >= 400) {
    throw new Error(`HTTP ${result.status}: ${(result.body || '').slice(0, 200)}`);
  }
  return result;
}

export async function runSync(pair, plan, onProgress, isCancelled) {
  let done = 0;
  const total = plan.toDownload.length + plan.toUpload.length;
  const errors = [];
  let cancelled = false;
  const tick = (extra) => {
    if (onProgress) onProgress({ done, total, ...extra });
  };
  for (const f of plan.toDownload) {
    if (isCancelled && isCancelled()) { cancelled = true; break; }
    tick({ current: f.name, dir: 'down', bytes: 0, totalBytes: f.size || 0 });
    try {
      await downloadOne(pair, f, (bytes, totalBytes) => {
        tick({ current: f.name, dir: 'down', bytes, totalBytes });
      });
    } catch (e) {
      errors.push({ direction: 'down', file: f.name, error: e.message });
      reportError('sync.download', e, { file: f.name });
    }
    done++;
    tick({ current: f.name, dir: 'down', bytes: f.size, totalBytes: f.size });
  }
  for (const f of plan.toUpload) {
    if (isCancelled && isCancelled()) { cancelled = true; break; }
    tick({ current: f.name, dir: 'up', bytes: 0, totalBytes: f.size });
    try {
      await uploadOne(pair, f, (bytes, totalBytes) => {
        tick({ current: f.name, dir: 'up', bytes, totalBytes });
      });
    } catch (e) {
      errors.push({ direction: 'up', file: f.name, error: e.message });
      reportError('sync.upload', e, { file: f.name });
    }
    done++;
    tick({ current: f.name, dir: 'up', bytes: f.size, totalBytes: f.size });
  }
  return { done, total, errors, cancelled };
}
