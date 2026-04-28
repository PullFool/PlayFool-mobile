// Minimal YouTube client built on the public Innertube API + fetch.
// Designed for React Native — no Node-only modules, no native deps.
import * as FileSystem from 'expo-file-system';

// Innertube web client — these constants are publicly known and used by YouTube.com itself.
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20240801.00.00';
const INNERTUBE_ANDROID_VERSION = '19.29.37';

const WEB_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: INNERTUBE_CLIENT_VERSION,
    hl: 'en',
    gl: 'US',
  },
};

// Android client returns deciphered stream URLs more reliably for many videos.
const ANDROID_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: INNERTUBE_ANDROID_VERSION,
    androidSdkVersion: 34,
    hl: 'en',
    gl: 'US',
    userAgent: `com.google.android.youtube/${INNERTUBE_ANDROID_VERSION} (Linux; U; Android 14)`,
  },
};

async function innertube(endpoint, body, context = WEB_CONTEXT) {
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/${endpoint}?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': context.client.clientName === 'ANDROID' ? '3' : '1',
        'X-YouTube-Client-Version': context.client.clientVersion,
      },
      body: JSON.stringify({ context, ...body }),
    }
  );
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  return res.json();
}

// Walk an arbitrary object tree and collect every videoRenderer it finds.
function collectVideos(node, results = []) {
  if (!node || results.length >= 100) return results;
  if (Array.isArray(node)) {
    for (const item of node) collectVideos(item, results);
    return results;
  }
  if (typeof node === 'object') {
    if (node.videoRenderer) {
      const v = node.videoRenderer;
      const id = v.videoId;
      const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
      const channel = v.ownerText?.runs?.[0]?.text ||
                      v.longBylineText?.runs?.[0]?.text ||
                      v.shortBylineText?.runs?.[0]?.text || 'YouTube';
      const duration = v.lengthText?.simpleText || '';
      const thumbnail = v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null;
      if (id) {
        results.push({
          id,
          title,
          channel,
          duration,
          thumbnail,
          url: `https://www.youtube.com/watch?v=${id}`,
        });
      }
    }
    for (const key of Object.keys(node)) collectVideos(node[key], results);
  }
  return results;
}

export async function searchMusic(query, limit = 30) {
  const data = await innertube('search', { query });
  const all = collectVideos(data);
  // De-dupe by id (search results sometimes repeat in shelves)
  const seen = new Set();
  const unique = [];
  for (const v of all) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    unique.push(v);
    if (unique.length >= limit) break;
  }
  return unique;
}

// Pick the best audio-only format from a player response.
function pickAudioFormat(playerResp) {
  const formats =
    playerResp?.streamingData?.adaptiveFormats || playerResp?.streamingData?.formats || [];
  // Prefer pure audio formats (mimeType starts with 'audio/'), then highest bitrate.
  const audio = formats
    .filter((f) => f.mimeType && f.mimeType.startsWith('audio/'))
    .filter((f) => f.url) // skip formats that need signature deciphering
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (audio.length > 0) return audio[0];
  // Fallback: any format with a direct url
  return formats.find((f) => f.url) || null;
}

export async function getAudioStreamUrl(videoId) {
  // ANDROID client tends to return non-deciphered URLs that work directly.
  const data = await innertube('player', { videoId }, ANDROID_CONTEXT);
  const fmt = pickAudioFormat(data);
  if (!fmt?.url) throw new Error('No playable audio stream found');
  return fmt.url;
}

const sanitize = (name) => (name || 'audio').replace(/[<>:"/\\|?*]+/g, '').slice(0, 120);

// Download audio to phone's PlayFool folder (app-private storage).
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
