// Minimal YouTube client built on the public Innertube API + fetch.
// Designed for React Native — no Node-only modules, no native deps.
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

// Innertube clients. These constants are baked into YouTube.com itself and are public knowledge.
const WEB_CLIENT = {
  apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  clientName: 'WEB',
  clientNameId: '1',
  clientVersion: '2.20241010.00.00',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

const ANDROID_CLIENT = {
  apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  clientName: 'ANDROID',
  clientNameId: '3',
  clientVersion: '19.29.37',
  androidSdkVersion: 34,
  userAgent: 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
};

// IOS client — used to be most reliable, lately failing with "Precondition check failed"
const IOS_CLIENT = {
  apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
  clientName: 'IOS',
  clientNameId: '5',
  clientVersion: '19.29.1',
  deviceModel: 'iPhone16,2',
  userAgent: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
};

// ANDROID_VR client — currently the most reliable for player.
// YouTube doesn't enforce anti-bot precondition checks on this surface yet.
const ANDROID_VR_CLIENT = {
  apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  clientName: 'ANDROID_VR',
  clientNameId: '28',
  clientVersion: '1.60.19',
  androidSdkVersion: 32,
  userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
};

// TVHTML5_SIMPLY_EMBEDDED_PLAYER — embed player surface, works for most public videos.
const TV_EMBED_CLIENT = {
  apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
  clientNameId: '85',
  clientVersion: '2.0',
  userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
};

function buildContext(client) {
  const ctx = {
    client: {
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      hl: 'en',
      gl: 'US',
    },
  };
  if (client.androidSdkVersion) ctx.client.androidSdkVersion = client.androidSdkVersion;
  if (client.deviceModel) ctx.client.deviceModel = client.deviceModel;
  if (client.userAgent) ctx.client.userAgent = client.userAgent;
  return ctx;
}

async function innertube(endpoint, body, client = WEB_CLIENT) {
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/${endpoint}?key=${client.apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': client.clientNameId,
        'X-YouTube-Client-Version': client.clientVersion,
        'User-Agent': client.userAgent,
        Origin: 'https://www.youtube.com',
      },
      body: JSON.stringify({ context: buildContext(client), ...body }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`YouTube ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }
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
  // YouTube tightens its bot checks on different client surfaces over time.
  // Walk through the most reliable clients until one returns a usable url.
  const body = { videoId, contentCheckOk: true, racyCheckOk: true };
  const clients = [ANDROID_VR_CLIENT, TV_EMBED_CLIENT, IOS_CLIENT, ANDROID_CLIENT];
  let lastError;
  for (const client of clients) {
    try {
      const data = await innertube('player', body, client);
      const fmt = pickAudioFormat(data);
      if (fmt?.url) return fmt.url;
      lastError = new Error(`No playable audio in ${client.clientName} response`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('No playable audio stream found');
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

// Ask for permission and scan every audio file on the phone via MediaLibrary.
// Returns songs in the same shape as listLocalAudio() so they merge cleanly.
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
      // Skip ringtones / notification sounds (very short)
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
