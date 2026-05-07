// PlayFool's hosted yt-dlp/ffmpeg backend. Single source of truth — no more
// chasing public Piped/Invidious/Cobalt instances that get blocked weekly.
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureSafFolder, getSafUri, safCreateFile, safListFiles, safDelete } from './saf';
import { getYoutubeStreamUrl } from './youtubeStream';

const API_BASE = 'https://playfool-api-production.up.railway.app/api/yt';
const DEFAULT_TIMEOUT = 12000; // generous so a Railway cold-start can finish

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(path, timeoutMs) {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  }, timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PlayFool API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const fmtDuration = (seconds) => {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export async function searchMusic(query, limit = 30) {
  const data = await apiGet(
    `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    20000 // search can take a few seconds on YouTube
  );
  // The server returns either {results: [...]} or a flat array — handle both.
  const items = Array.isArray(data) ? data : (data.results || []);
  return items.map((it) => ({
    id: it.id,
    title: it.title || '',
    channel: it.channel || it.uploader || 'YouTube',
    duration: typeof it.duration === 'number' ? fmtDuration(it.duration) : (it.duration || ''),
    thumbnail: it.thumbnail || (it.id ? `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg` : null),
    url: it.url || (it.id ? `https://www.youtube.com/watch?v=${it.id}` : ''),
  })).filter((v) => v.id);
}

export async function getAudioStreamUrl(videoId) {
  // First try phone-side Innertube extraction. The phone's IP is residential
  // so YouTube doesn't bot-wall us the way it does our Railway data-center
  // IP. When this works we don't even hit our API — the phone talks straight
  // to youtube.com and gets a googlevideo URL.
  try {
    const url = await getYoutubeStreamUrl(videoId);
    if (url) return url;
  } catch (e) {
    // Fall through to the API tier; the API has a layered fallback chain
    // that may still find the stream from one of its scraper backends.
  }

  // 30s — server walks several yt-dlp player clients in parallel and may
  // legitimately need longer than the default 12s on a cold Railway dyno.
  const data = await apiGet(`/stream/${videoId}`, 30000);
  const url = data?.url || data?.audio || null;
  if (!url) throw new Error('No playable audio stream returned by API');
  return url;
}

const sanitize = (name) =>
  (name || 'audio').replace(/[<>:"/\\|?*]+/g, '').slice(0, 120);

const ALBUM_NAME = 'PlayFool';

export async function downloadAudio(video, onProgress) {
  // 1. Download to app cache (temp location).
  const url = await getAudioStreamUrl(video.id);
  const cacheDir = FileSystem.cacheDirectory + 'PlayFool-dl/';
  await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});
  const filename = `${sanitize(video.title)}.m4a`;
  const tempUri = cacheDir + filename;

  const dl = FileSystem.createDownloadResumable(
    url,
    tempUri,
    {},
    (snapshot) => {
      if (onProgress && snapshot.totalBytesExpectedToWrite > 0) {
        const pct = Math.round(
          (snapshot.totalBytesWritten / snapshot.totalBytesExpectedToWrite) * 100
        );
        onProgress(pct);
      }
    }
  );
  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');

  // 2. Move into the SAF folder. The user picked this folder once at first
  //    launch; PlayFool has persistent permission inside it. No "Allow
  //    modify" prompt is shown because the folder is not MediaStore-owned.
  const safUri = await ensureSafFolder();
  const finalUri = await safCreateFile(safUri, filename, 'audio/mp4', result.uri);

  // 3. Clean up the cache copy.
  try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch (e) {}

  return { uri: finalUri, filename, title: video.title };
}

// Match songs by their base name with the same normalization sync.js uses.
// Same file showing up in multiple storage sources gets collapsed.
function localSongKey(name) {
  if (!name) return '';
  return String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// List downloaded audio. Reads:
// 1. The SAF folder (current downloads — silent delete, no Android prompts)
// 2. Legacy MediaStore 'PlayFool' album (older installs — Android still prompts)
// 3. Legacy app-private folder (very old installs)
//
// SAF entries take priority — if the same song appears in both SAF and
// legacy MediaStore (because it was downloaded before v1.0.36 then re-synced
// after), we list only the SAF copy so My Music doesn't show duplicates.
export async function listLocalAudio() {
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    const key = localSongKey(entry.title || entry.url || '');
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(entry);
  };

  // 1. New location: SAF folder
  try {
    const safUri = await getSafUri();
    if (safUri) {
      const files = await safListFiles(safUri);
      for (const f of files) {
        push({
          id: 'saf-' + encodeURIComponent(f.uri),
          safUri: f.uri,
          title: f.name.replace(/\.[^.]+$/, '') || 'Unknown',
          artist: 'PlayFool',
          url: f.uri,
          cover: null,
          source: 'saf',
          size: f.size,
        });
      }
    }
  } catch (e) {}

  // 2. Legacy: MediaStore PlayFool album
  try {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (perm.granted) {
      const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
      if (album) {
        let endCursor;
        let hasNextPage = true;
        while (hasNextPage) {
          const page = await MediaLibrary.getAssetsAsync({
            album: album.id,
            mediaType: MediaLibrary.MediaType.audio,
            first: 100,
            after: endCursor,
          });
          for (const asset of page.assets) {
            push({
              id: 'local-' + asset.id,
              assetId: asset.id,
              title: (asset.filename || '').replace(/\.[^.]+$/, '') || 'Unknown',
              artist: 'PlayFool',
              url: asset.uri,
              cover: null,
              source: 'local',
              duration: asset.duration,
            });
          }
          endCursor = page.endCursor;
          hasNextPage = page.hasNextPage;
        }
      }
    }
  } catch (e) { /* fall through to legacy reader */ }

  // Legacy: app-private documentDirectory PlayFool folder.
  try {
    const dir = FileSystem.documentDirectory + 'PlayFool/';
    const exists = await FileSystem.getInfoAsync(dir);
    if (exists.exists) {
      const files = await FileSystem.readDirectoryAsync(dir);
      const audio = files.filter((f) => /\.(m4a|mp3|webm|opus|ogg)$/i.test(f));
      for (const f of audio) {
        const title = f.replace(/\.[^.]+$/, '');
        push({
          id: 'legacy-' + f,
          title,
          artist: 'PlayFool',
          url: dir + f,
          cover: null,
          source: 'local-legacy',
        });
      }
    }
  } catch (e) {}

  return out;
}

// Delete a downloaded song.
//   - SAF-stored files (source === 'saf') delete silently, no Android prompt.
//   - Legacy MediaStore assets still go through MediaLibrary.deleteAssetsAsync,
//     which on Android 11+ shows the system "Allow modify" dialog. One-time
//     pain to clean up old downloads from before SAF.
export async function deleteLocalAudio(song) {
  if (typeof song === 'string') {
    return FileSystem.deleteAsync(song, { idempotent: true });
  }
  if (song?.safUri) {
    await safDelete(song.safUri);
    return;
  }
  if (song?.assetId) {
    await MediaLibrary.deleteAssetsAsync([song.assetId]);
    return;
  }
  if (song?.url) {
    return FileSystem.deleteAsync(song.url, { idempotent: true });
  }
  throw new Error('Nothing to delete');
}

// Find pairs of MediaStore audio assets with the same filename — typical
// pattern from older PlayFool versions that called addAssetsToAlbumAsync
// with copy=true, which physically duplicated bytes to /Music/<file>
// AND /Music/PlayFool/<file>. Keeps the one inside the PlayFool folder,
// queues the loose copies for deletion. One Android prompt covers them all.
export async function cleanupDuplicates() {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Permission denied');

  const all = [];
  let endCursor;
  let hasNextPage = true;
  while (hasNextPage) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: 100,
      after: endCursor,
    });
    all.push(...page.assets);
    endCursor = page.endCursor;
    hasNextPage = page.hasNextPage;
  }

  const byName = new Map();
  for (const a of all) {
    const arr = byName.get(a.filename) || [];
    arr.push(a);
    byName.set(a.filename, arr);
  }

  const toDelete = [];
  for (const [, assets] of byName) {
    if (assets.length < 2) continue;
    const withPaths = await Promise.all(assets.map(async (a) => {
      const info = await MediaLibrary.getAssetInfoAsync(a).catch(() => null);
      return { ...a, localUri: info?.localUri || a.uri };
    }));
    const keeper = withPaths.find((a) => /\/PlayFool\//i.test(a.localUri || ''));
    const losers = keeper
      ? withPaths.filter((a) => a.id !== keeper.id)
      : withPaths.slice(1);
    for (const x of losers) toDelete.push(x.id);
  }

  if (toDelete.length === 0) return { found: 0, deleted: 0 };
  await MediaLibrary.deleteAssetsAsync(toDelete);
  return { found: toDelete.length, deleted: toDelete.length };
}

export async function scanPhoneAudio({ onProgress } = {}) {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) {
    const err = new Error('Audio library permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }

  const PAGE_SIZE = 100;
  const all = [];
  let endCursor;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.audio,
      first: PAGE_SIZE,
      after: endCursor,
    });
    for (const asset of page.assets) {
      if ((asset.duration || 0) < 10) continue;
      all.push({
        id: 'scan-' + asset.id,
        title: (asset.filename || '').replace(/\.[^.]+$/, '') || 'Unknown',
        artist: 'Phone',
        url: asset.uri,
        cover: null,
        source: 'scanned',
        duration: asset.duration,
      });
    }
    endCursor = page.endCursor;
    hasNextPage = page.hasNextPage;
    if (onProgress) onProgress(all.length);
  }
  return all;
}
