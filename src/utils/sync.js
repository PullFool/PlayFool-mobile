// Cloud sync — phone and PC share a "sync code" and exchange songs through a
// Cloudflare R2-backed Worker. Files are deleted from the relay as soon as the
// receiver confirms. Local diff uses filename+size to avoid re-transferring
// the same song.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { reportError } from './errorReporter';
import { ensureSafFolder, getSafUri, safCreateFile, safListFiles } from './saf';

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
  // 1. SAF folder (current downloads — uploaded via SAF URI)
  try {
    const safUri = await getSafUri();
    if (safUri) {
      const files = await safListFiles(safUri);
      for (const f of files) out.push({ name: f.name, size: f.size, uri: f.uri });
    }
  } catch (e) {}
  // 2. Legacy MediaStore PlayFool album (older installs still uploading from there)
  try {
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
  } catch (e) {}
  return out;
}

async function listCloud(pair) {
  const data = await fetchJson(`${pair.base}/v1/list?code=${encodeURIComponent(pair.code)}`);
  return data.files || [];
}

// Match songs by base name with aggressive normalization so the same song
// stored as .mp3 on one device and .m4a on another (and slightly different
// punctuation between yt-dlp on PC and the mobile app) doesn't get
// treated as separate files.
function songKey(name) {
  if (!name) return '';
  return String(name)
    .replace(/\.[^.]+$/, '')          // strip extension
    .replace(/[^\p{L}\p{N}\s]/gu, '')  // strip punctuation (apostrophes, hyphens, em-dashes...)
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim()
    .toLowerCase();
}

// Drop duplicate keys, keeping the first occurrence. Used to clean up
// local lists where SAF and legacy MediaStore both expose the same song.
function dedupByKey(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// Diff: cloud-only → toDownload; local-only → toUpload. Match by song name.
export async function planSync(pair) {
  const cloudRaw = await listCloud(pair);
  const localRaw = await listLocal();
  const cloud = dedupByKey(cloudRaw, (f) => songKey(f.name));
  const local = dedupByKey(localRaw, (f) => songKey(f.name));
  const localSet = new Set(local.map((f) => songKey(f.name)));
  const cloudSet = new Set(cloud.map((f) => songKey(f.name)));
  const toDownload = cloud.filter((f) => !localSet.has(songKey(f.name)));
  const toUpload = local.filter((f) => !cloudSet.has(songKey(f.name)));
  return { cloud, local, toDownload, toUpload };
}

async function downloadOne(pair, file, onBytes) {
  const tempDir = FileSystem.cacheDirectory + 'PlayFool-sync/';
  await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true }).catch(() => {});
  // Strip any path separators or weird chars from the server-provided name —
  // older R2 entries can have a name that's actually the full "code/id" key,
  // which Android's downloader interprets as a missing subdirectory.
  let safeName = String(file.name || file.id || 'song').split(/[\/\\]/).pop().replace(/[^\w.\- ()]/g, '_') || 'song';
  // MediaStore needs a recognized audio extension to import. If the server
  // returned a bare id (legacy uploads), assume m4a since that's what mobile
  // downloads as.
  if (!/\.(mp3|m4a|opus|webm|ogg|wav|aac|flac)$/i.test(safeName)) {
    safeName += '.m4a';
  }
  const tempUri = tempDir + safeName;
  const url = `${pair.base}/v1/file/${file.id}?code=${encodeURIComponent(pair.code)}`;
  const dl = FileSystem.createDownloadResumable(url, tempUri, {}, (snap) => {
    if (onBytes) onBytes(snap.totalBytesWritten, snap.totalBytesExpectedToWrite);
  });
  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');
  // Move into the user's SAF folder — silent, no Android prompt.
  const safUri = await ensureSafFolder();
  const finalUri = await safCreateFile(safUri, safeName, 'audio/mp4', result.uri);
  try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch (e) {}
  // We intentionally do NOT confirm-delete the cloud copy here. Leaving
  // the file on R2 for up to 24h (the cron cleanup window) lets the same
  // device re-sync without re-uploading and lets multiple peers on the
  // same code each pull it. The 24h cron is the only cleanup.
  return { uri: finalUri };
}

async function uploadOne(pair, file, onBytes) {
  const url = `${pair.base}/v1/upload?code=${encodeURIComponent(pair.code)}&name=${encodeURIComponent(file.name)}&size=${file.size}`;
  // FileSystem.createUploadTask can't directly read SAF content:// URIs,
  // so for SAF-stored files we first copy the bytes into our app cache
  // and upload from there. The cache copy is deleted immediately after.
  let uploadUri = file.uri;
  let tempCopy = null;
  if (typeof file.uri === 'string' && file.uri.startsWith('content://')) {
    const cacheDir = FileSystem.cacheDirectory + 'PlayFool-upload/';
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});
    const safeName = String(file.name || 'song').replace(/[^\w.\- ()]/g, '_');
    tempCopy = cacheDir + safeName;
    try {
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.writeAsStringAsync(tempCopy, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      uploadUri = tempCopy;
    } catch (e) {
      throw new Error(`SAF read failed: ${e.message}`);
    }
  }
  try {
    const task = FileSystem.createUploadTask(
      url,
      uploadUri,
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
  } finally {
    if (tempCopy) {
      try { await FileSystem.deleteAsync(tempCopy, { idempotent: true }); } catch (e) {}
    }
  }
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
