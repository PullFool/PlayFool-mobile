// LAN sync with PlayFool desktop. Pairs by address+PIN, lists the remote
// library, then transfers anything missing in either direction.
// Files are matched by filename + size — same name + same byte count =
// considered the same song and skipped.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { reportError } from './errorReporter';

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

function normalizeAddress(input) {
  let a = String(input || '').trim();
  a = a.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!a.includes(':')) a = `${a}:3000`;
  return `http://${a}`;
}

async function fetchJson(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    return res.json();
  } finally { clearTimeout(timer); }
}

export async function pairWith(addressInput, pin) {
  const base = normalizeAddress(addressInput);
  const token = String(pin || '').trim().toUpperCase();
  if (!token) throw new Error('Enter the PIN shown on your PC');
  const info = await fetchJson(
    `${base}/api/sync/info?token=${encodeURIComponent(token)}`,
    { headers: { Accept: 'application/json' } },
    6000
  );
  if (!info?.ok) throw new Error('PC rejected the PIN');
  const pair = { base, token, name: info.name || 'PC', pairedAt: Date.now() };
  await setPairing(pair);
  return pair;
}

async function listRemote(pair) {
  const peerName = 'PlayFool Mobile';
  return fetchJson(
    `${pair.base}/api/sync/library?token=${encodeURIComponent(pair.token)}`,
    { headers: { 'X-PlayFool-Peer': peerName } },
    10000
  );
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
      out.push({
        name: asset.filename,
        size,
        uri: localUri,
        assetId: asset.id,
      });
    }
    endCursor = page.endCursor;
    hasNextPage = page.hasNextPage;
  }
  return out;
}

// Diff: anything on PC not on phone (by name+size) → toDownload
//       anything on phone not on PC                  → toUpload
export async function planSync(pair) {
  const remote = (await listRemote(pair)).files || [];
  const local = await listLocal();
  const localKey = (f) => `${f.name}|${f.size}`;
  const localSet = new Set(local.map(localKey));
  const remoteSet = new Set(remote.map(localKey));
  const toDownload = remote.filter((f) => !localSet.has(localKey(f)));
  const toUpload = local.filter((f) => !remoteSet.has(localKey(f)));
  return { remote, local, toDownload, toUpload };
}

async function downloadOne(pair, file, onProgress) {
  const tempDir = FileSystem.cacheDirectory + 'PlayFool-sync/';
  await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => {});
  const tempUri = tempDir + file.name;
  const url = `${pair.base}/api/sync/file/${encodeURIComponent(file.name)}?token=${encodeURIComponent(pair.token)}`;
  const dl = FileSystem.createDownloadResumable(url, tempUri, {}, (snap) => {
    if (onProgress && snap.totalBytesExpectedToWrite > 0) {
      onProgress(Math.round((snap.totalBytesWritten / snap.totalBytesExpectedToWrite) * 100));
    }
  });
  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');
  // Move into MediaStore PlayFool album so it shows in My Music + survives uninstall.
  const asset = await MediaLibrary.createAssetAsync(result.uri);
  try {
    let album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
    if (!album) album = await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
    else await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
  } catch (e) {}
  try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch (e) {}
  return asset;
}

async function uploadOne(pair, file, onProgress) {
  const url = `${pair.base}/api/sync/upload?token=${encodeURIComponent(pair.token)}`;
  const result = await FileSystem.uploadAsync(url, file.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-PlayFool-Filename': file.name,
    },
  });
  if (onProgress) onProgress(100);
  if (result.status >= 400 && result.status !== 409) {
    throw new Error(`Upload failed: ${result.status}`);
  }
  return result;
}

export async function runSync(pair, plan, onProgress) {
  let done = 0;
  const total = plan.toDownload.length + plan.toUpload.length;
  const errors = [];
  for (const f of plan.toDownload) {
    try {
      await downloadOne(pair, f);
    } catch (e) {
      errors.push({ direction: 'down', file: f.name, error: e.message });
      reportError('sync.download', e, { file: f.name });
    }
    done++;
    if (onProgress) onProgress({ done, total, current: f.name, dir: 'down' });
  }
  for (const f of plan.toUpload) {
    try {
      await uploadOne(pair, f);
    } catch (e) {
      errors.push({ direction: 'up', file: f.name, error: e.message });
      reportError('sync.upload', e, { file: f.name });
    }
    done++;
    if (onProgress) onProgress({ done, total, current: f.name, dir: 'up' });
  }
  return { done, total, errors };
}
