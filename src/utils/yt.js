// PlayFool's hosted yt-dlp/ffmpeg backend. Single source of truth — no more
// chasing public Piped/Invidious/Cobalt instances that get blocked weekly.
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

const API_BASE = 'https://adrianborboran.up.railway.app/api/yt';
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
  const data = await apiGet(`/stream/${videoId}`, 15000);
  const url = data?.url || data?.audio || null;
  if (!url) throw new Error('No playable audio stream returned by API');
  return url;
}

const sanitize = (name) =>
  (name || 'audio').replace(/[<>:"/\\|?*]+/g, '').slice(0, 120);

export async function downloadAudio(video, onProgress) {
  const url = await getAudioStreamUrl(video.id);
  const dir = FileSystem.documentDirectory + 'PlayFool/';
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const filename = `${sanitize(video.title)}.m4a`;
  const target = dir + filename;

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    target,
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

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');
  return { uri: result.uri, filename, title: video.title };
}

export async function listLocalAudio() {
  const dir = FileSystem.documentDirectory + 'PlayFool/';
  const exists = await FileSystem.getInfoAsync(dir);
  if (!exists.exists) return [];
  const files = await FileSystem.readDirectoryAsync(dir);
  const audio = files.filter((f) => /\.(m4a|mp3|webm|opus|ogg)$/i.test(f));
  return audio.map((f) => ({
    id: 'local-' + f,
    title: f.replace(/\.[^.]+$/, ''),
    artist: 'PlayFool',
    url: dir + f,
    cover: null,
    source: 'local',
  }));
}

export async function deleteLocalAudio(uri) {
  await FileSystem.deleteAsync(uri, { idempotent: true });
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
