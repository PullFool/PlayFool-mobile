// YouTube client backed by Piped — open-source YouTube proxy that handles PoToken
// (YouTube's anti-bot system) on its servers. We're a thin client over fetch.
// https://github.com/TeamPiped/Piped
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

// Public Piped instances to try in order. If one is down or rate-limited, fall through.
// List curated from https://piped-instances.kavin.rocks/ in 2025.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.smnz.de',
  'https://api-piped.mha.fi',
  'https://pipedapi.darkness.services',
];

async function pipedFetch(path) {
  let lastError;
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(base + path, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        lastError = new Error(`${base} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      return data;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All Piped instances failed');
}

const fmtDuration = (seconds) => {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

function videoIdFromPipedItem(item) {
  // Piped uses url like "/watch?v=DcO_rKzlmt4" or full youtube urls
  if (!item?.url) return null;
  const match = item.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

export async function searchMusic(query, limit = 30) {
  // filter=music_songs gets cleaner audio results, falls through to videos otherwise
  const data = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=music_songs`);
  const items = (data?.items || []).filter((it) => it.type === 'stream' || !it.type);
  const mapped = [];
  const seen = new Set();
  for (const it of items) {
    const id = videoIdFromPipedItem(it);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mapped.push({
      id,
      title: it.title || '',
      channel: it.uploaderName || it.uploader || 'YouTube',
      duration: fmtDuration(it.duration),
      thumbnail: it.thumbnail || null,
      url: `https://www.youtube.com/watch?v=${id}`,
    });
    if (mapped.length >= limit) break;
  }
  // If music_songs returned almost nothing, retry with a broader search
  if (mapped.length < 5) {
    const data2 = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=videos`);
    const items2 = (data2?.items || []).filter((it) => it.type === 'stream' || !it.type);
    for (const it of items2) {
      const id = videoIdFromPipedItem(it);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      mapped.push({
        id,
        title: it.title || '',
        channel: it.uploaderName || it.uploader || 'YouTube',
        duration: fmtDuration(it.duration),
        thumbnail: it.thumbnail || null,
        url: `https://www.youtube.com/watch?v=${id}`,
      });
      if (mapped.length >= limit) break;
    }
  }
  return mapped;
}

function pickBestAudio(streams) {
  if (!Array.isArray(streams) || !streams.length) return null;
  // Prefer m4a (mp4 audio) for best Android compatibility, then by bitrate.
  const sorted = [...streams].sort((a, b) => {
    const aMp4 = (a.mimeType || '').includes('mp4') ? 1 : 0;
    const bMp4 = (b.mimeType || '').includes('mp4') ? 1 : 0;
    if (aMp4 !== bMp4) return bMp4 - aMp4;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
  return sorted[0];
}

export async function getAudioStreamUrl(videoId) {
  const data = await pipedFetch(`/streams/${videoId}`);
  const fmt = pickBestAudio(data?.audioStreams);
  if (!fmt?.url) throw new Error('No playable audio stream found');
  return fmt.url;
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
