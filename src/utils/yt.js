// PlayFool's hosted yt-dlp/ffmpeg backend. Single source of truth — no more
// chasing public Piped/Invidious/Cobalt instances that get blocked weekly.
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

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

  // 2. Hand the file to the system Music library so it survives uninstall and
  //    is visible to other music apps. Requires media-library permission.
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) {
    // Fall back to keeping the file in app cache if the user refused.
    return { uri: result.uri, filename, title: video.title };
  }

  const asset = await MediaLibrary.createAssetAsync(result.uri);
  try {
    let album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
    if (!album) {
      album = await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
    } else {
      // copy=true avoids Android 11+'s "allow modify" permission dialog.
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, true);
    }
  } catch (e) {
    // Album organization is best-effort. The file still ends up in /Music/.
  }

  // 3. Clean up the cache copy. The MediaStore now owns the file at its public
  //    path. expo-file-system can delete from cacheDirectory we own.
  try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch (e) {}

  return { uri: asset.uri, assetId: asset.id, filename, title: video.title };
}

// List downloaded audio. Reads both:
// 1. The MediaLibrary 'PlayFool' album (new public-folder downloads)
// 2. Legacy app-private folder (for users upgrading from older versions)
export async function listLocalAudio() {
  const out = [];

  // New location: MediaStore PlayFool album
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
            out.push({
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
      const seen = new Set(out.map((s) => (s.title || '').toLowerCase()));
      for (const f of audio) {
        const title = f.replace(/\.[^.]+$/, '');
        if (seen.has(title.toLowerCase())) continue;
        out.push({
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

// Delete a downloaded song. MediaLibrary assets need MediaLibrary.deleteAssetsAsync;
// legacy app-private files use FileSystem.deleteAsync.
export async function deleteLocalAudio(song) {
  // Backwards-compat: callers used to pass a uri string. Accept either.
  if (typeof song === 'string') {
    return FileSystem.deleteAsync(song, { idempotent: true });
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
