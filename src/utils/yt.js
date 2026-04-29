// YouTube client backed by Piped — open-source YouTube proxy that handles PoToken
// (YouTube's anti-bot system) on its servers. We're a thin client over fetch.
// https://github.com/TeamPiped/Piped
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

// Public Piped instances. Many have been shut down or rate-limited as YouTube
// cracks down — keep this list short and current.
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.smnz.de',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.ducks.party',
];

// Invidious is a parallel project with the same idea. We use these as a
// search-only fallback if every Piped instance is unreachable.
const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://yewtu.be',
  'https://invidious.private.coffee',
  'https://iv.melmac.space',
  'https://inv.nadeko.net',
];

// Cobalt API v10 instances — currently active in 2025.
const COBALT_INSTANCES = [
  'https://api.dl.ovh',
  'https://capi.oat.zone',
  'https://co.eepy.today',
  'https://cobalt.synzr.ru',
  'https://cobalt-backend.canine.tools',
  'https://cobalt-api.kwiatekmiki.com',
];

// fetch with a timeout — RN's default fetch never aborts on a hung instance.
async function fetchWithTimeout(url, init = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryFetch(bases, pathOrFactory, init = {}, timeoutMs = 7000) {
  let lastError;
  for (const base of bases) {
    try {
      const url = typeof pathOrFactory === 'function' ? pathOrFactory(base) : base + pathOrFactory;
      const res = await fetchWithTimeout(url, {
        ...init,
        headers: { Accept: 'application/json', ...(init.headers || {}) },
      }, timeoutMs);
      if (!res.ok) {
        lastError = new Error(`${base} returned ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All instances failed');
}

const pipedFetch = (path) => tryFetch(PIPED_INSTANCES, path);

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

async function searchViaPiped(query, limit) {
  const data = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=videos`);
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
  return mapped;
}

async function searchViaInvidious(query, limit) {
  const items = await tryFetch(INVIDIOUS_INSTANCES,
    `/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
  const mapped = [];
  const seen = new Set();
  for (const it of items || []) {
    const id = it.videoId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mapped.push({
      id,
      title: it.title || '',
      channel: it.author || 'YouTube',
      duration: fmtDuration(it.lengthSeconds),
      thumbnail: it.videoThumbnails?.[0]?.url || null,
      url: `https://www.youtube.com/watch?v=${id}`,
    });
    if (mapped.length >= limit) break;
  }
  return mapped;
}

export async function searchMusic(query, limit = 30) {
  // Try Piped first; if every instance is unreachable, fall back to Invidious.
  try {
    const r = await searchViaPiped(query, limit);
    if (r.length > 0) return r;
  } catch (e) { /* fall through */ }
  return searchViaInvidious(query, limit);
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

async function getAudioFromPiped(videoId) {
  const data = await pipedFetch(`/streams/${videoId}`);
  const fmt = pickBestAudio(data?.audioStreams);
  return fmt?.url || null;
}

async function getAudioFromInvidious(videoId) {
  // Invidious /api/v1/videos/{id} returns adaptiveFormats[] with direct urls.
  const data = await tryFetch(INVIDIOUS_INSTANCES, `/api/v1/videos/${videoId}`);
  const formats = data?.adaptiveFormats || [];
  // Audio formats have type starting with "audio/"
  const audio = formats
    .filter((f) => (f.type || f.mimeType || '').startsWith('audio/'))
    .filter((f) => f.url)
    .sort((a, b) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0));
  return audio[0]?.url || null;
}

async function cobaltRequest(base, body, version) {
  // Cobalt v10 uses POST / with downloadMode; v7 used POST /api/json with isAudioOnly.
  const path = version === 'v10' ? '/' : '/api/json';
  const res = await fetchWithTimeout(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }, 10000);
  if (!res.ok) throw new Error(`${base} ${res.status}`);
  return res.json();
}

async function getAudioFromCobalt(videoId) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let lastError;
  for (const base of COBALT_INSTANCES) {
    // Try v10 schema first (most current), fall back to v7 schema.
    for (const [version, body] of [
      ['v10', { url: youtubeUrl, downloadMode: 'audio', audioFormat: 'best', filenameStyle: 'basic' }],
      ['v7', { url: youtubeUrl, isAudioOnly: true, audioFormat: 'best' }],
    ]) {
      try {
        const data = await cobaltRequest(base, body, version);
        if (data?.status === 'error') { lastError = new Error(data.text || 'cobalt error'); continue; }
        if (data?.url) return data.url;
        if (data?.audio) return data.audio;
      } catch (e) { lastError = e; }
    }
  }
  if (lastError) throw lastError;
  return null;
}

// Try to grab a stream url through the Piped proxy by hitting
// pipedproxy directly — works for videos that fail through the API.
async function getAudioFromPipedProxy(videoId) {
  // The /streams/{id} response sometimes carries a deciphered url even when
  // its audioStreams array is empty; pull it from the embed URL too.
  const embedHosts = [
    'https://piped.video',
    'https://piped.kavin.rocks',
    'https://piped.privacy.com.de',
  ];
  for (const host of embedHosts) {
    try {
      const html = await fetchWithTimeout(`${host}/embed/${videoId}`, {}, 7000)
        .then((r) => (r.ok ? r.text() : ''));
      const match = html.match(/"audioStream":\s*"([^"]+\.googlevideo\.com[^"]*)"/);
      if (match) return match[1].replace(/\\u0026/g, '&');
    } catch (e) { /* try next */ }
  }
  return null;
}

export async function getAudioStreamUrl(videoId) {
  // Collect a per-tier failure summary so the user / Discord webhook know
  // exactly which providers failed and why instead of seeing only the last error.
  const errors = [];
  // Tier 1: Piped API — direct CDN url, fastest when available.
  try {
    const url = await getAudioFromPiped(videoId);
    if (url) return url;
    errors.push('Piped: no audio in response');
  } catch (e) { errors.push(`Piped: ${e.message || e}`); }
  // Tier 2: Invidious — same idea as Piped, different network.
  try {
    const url = await getAudioFromInvidious(videoId);
    if (url) return url;
    errors.push('Invidious: no audio in response');
  } catch (e) { errors.push(`Invidious: ${e.message || e}`); }
  // Tier 3: Cobalt — heavier hitters that proxy the actual file.
  try {
    const url = await getAudioFromCobalt(videoId);
    if (url) return url;
    errors.push('Cobalt: no audio in response');
  } catch (e) { errors.push(`Cobalt: ${e.message || e}`); }
  // Tier 4: Piped embed page scrape — last-ditch.
  try {
    const url = await getAudioFromPipedProxy(videoId);
    if (url) return url;
    errors.push('PipedProxy: no audio extracted');
  } catch (e) { errors.push(`PipedProxy: ${e.message || e}`); }

  throw new Error('All providers failed:\n' + errors.join('\n'));
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
