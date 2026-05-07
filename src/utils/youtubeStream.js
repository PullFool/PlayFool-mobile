// Phone-side YouTube stream extraction. Calls YouTube's internal Innertube
// API (the same one official YouTube apps use) directly from the phone, so
// YouTube sees a residential IP — no bot wall, no PoToken, no cookies
// needed. The Android client returns plain URLs in adaptiveFormats most of
// the time, which expo-av and FileSystem.createDownloadResumable can stream
// directly.

const INNERTUBE_PATH = '/youtubei/v1/player?prettyPrint=false';
const ANDROID_USER_AGENT = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
const ANDROID_CLIENT_VERSION = '19.09.37';

async function fetchInnertube(videoId, client) {
  const body = {
    videoId,
    context: { client },
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch(`https://www.youtube.com${INNERTUBE_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-YouTube-Client-Name': String(client.clientName === 'ANDROID' ? 3 : (client.clientName === 'IOS' ? 5 : 1)),
      'X-YouTube-Client-Version': client.clientVersion,
      'User-Agent': client.userAgent || ANDROID_USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

const CLIENTS = [
  // Android client — usually returns plain URLs, no signature decryption needed.
  {
    clientName: 'ANDROID',
    clientVersion: ANDROID_CLIENT_VERSION,
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    platform: 'MOBILE',
    userAgent: ANDROID_USER_AGENT,
  },
  // iOS client — fallback if Android client gets gated.
  {
    clientName: 'IOS',
    clientVersion: '19.09.3',
    deviceModel: 'iPhone14,3',
    osName: 'iOS',
    osVersion: '15.6.0.19G71',
    platform: 'MOBILE',
    userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
  },
];

function pickBestAudioUrl(streamingData) {
  const formats = streamingData?.adaptiveFormats || [];
  const audio = formats.filter((f) =>
    typeof f?.mimeType === 'string'
    && f.mimeType.startsWith('audio/')
    && typeof f.url === 'string'           // skip encrypted (signatureCipher) entries
    && f.url.startsWith('http'),
  );
  if (audio.length === 0) return null;
  audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return audio[0].url;
}

export async function getYoutubeStreamUrl(videoId) {
  let lastErr = '';
  for (const client of CLIENTS) {
    try {
      const data = await fetchInnertube(videoId, client);
      const status = data?.playabilityStatus?.status;
      if (status && status !== 'OK') {
        lastErr = `${client.clientName}: ${data.playabilityStatus.reason || status}`;
        continue;
      }
      const url = pickBestAudioUrl(data?.streamingData);
      if (url) return url;
      lastErr = `${client.clientName}: no playable audio formats`;
    } catch (e) {
      lastErr = `${client.clientName}: ${e.message}`;
    }
  }
  throw new Error(lastErr || 'all clients failed');
}
