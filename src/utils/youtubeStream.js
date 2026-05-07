// Phone-side YouTube stream extraction. Calls YouTube's internal Innertube
// API directly from the phone (residential IP), so we bypass the data-center
// bot wall hitting the Railway API.
//
// Client strategy: try the clients least likely to require a PoToken first.
// As of 2025 YouTube has been forcing PoToken on the standard ANDROID/IOS
// mobile clients; TVHTML5 and ANDROID_VR generally still pass without one.

// Public Innertube API keys baked into the official YouTube apps. These are
// hardcoded inside the published binaries, openly documented, and shared
// across millions of installs — they are not secrets. Without them the
// non-WEB clients return HTTP 400 "Precondition check failed" because Google's
// API gateway rejects keyless requests for those client codes.
const INNERTUBE_API_KEYS = {
  WEB: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  ANDROID: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  IOS: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8',
  WEB_EMBEDDED_PLAYER: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  WEB_REMIX: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
  MWEB: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
};

const CLIENT_NAME_TO_ID = {
  WEB: 1,
  MWEB: 2,
  ANDROID: 3,
  IOS: 5,
  WEB_REMIX: 67,
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: 85,
  WEB_EMBEDDED_PLAYER: 56,
};

async function fetchInnertube(videoId, client) {
  const body = {
    videoId,
    context: { client },
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const clientId = CLIENT_NAME_TO_ID[client.clientName] || 1;
  const apiKey = INNERTUBE_API_KEYS[client.clientName];
  const url = `https://www.youtube.com/youtubei/v1/player?prettyPrint=false${apiKey ? `&key=${apiKey}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-YouTube-Client-Name': String(clientId),
      'X-YouTube-Client-Version': client.clientVersion,
      'User-Agent': client.userAgent || 'Mozilla/5.0',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

// Order matters — try clients least likely to bot-wall or PoToken-gate first.
const CLIENTS = [
  // TV embedded — current version, widely used by smart TVs / consoles.
  {
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '7.20250101.10.00',
    platform: 'TV',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
  },
  // YouTube Music client — music content frequently plays here even when
  // standard YouTube clients refuse.
  {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250101.01.00',
    platform: 'DESKTOP',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  // Mobile web — different gate than the native mobile apps.
  {
    clientName: 'MWEB',
    clientVersion: '2.20250101.01.00',
    platform: 'MOBILE',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  // Web embedded — alternative path; works for embeddable videos.
  {
    clientName: 'WEB_EMBEDDED_PLAYER',
    clientVersion: '1.20240530.00.00',
    platform: 'DESKTOP',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  // Standard mobile clients — now PoToken-gated; with API key the request at
  // least gets processed and returns a real status (instead of HTTP 400).
  {
    clientName: 'IOS',
    clientVersion: '19.45.4',
    deviceModel: 'iPhone16,2',
    osName: 'iOS',
    osVersion: '17.5.1.21F90',
    platform: 'MOBILE',
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
  },
  {
    clientName: 'ANDROID',
    clientVersion: '19.50.42',
    androidSdkVersion: 33,
    osName: 'Android',
    osVersion: '13',
    platform: 'MOBILE',
    userAgent: 'com.google.android.youtube/19.50.42 (Linux; U; Android 13) gzip',
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

// Diagnostic: detect why a streamingData was unusable. Helps the next error
// surface tell us "all formats are signatureCipher" vs "no formats at all".
function describeStreamingFailure(streamingData) {
  const formats = streamingData?.adaptiveFormats || [];
  if (formats.length === 0) return 'no adaptiveFormats';
  const audio = formats.filter((f) => typeof f?.mimeType === 'string' && f.mimeType.startsWith('audio/'));
  if (audio.length === 0) return 'no audio formats';
  const ciphered = audio.filter((f) => !f.url && (f.signatureCipher || f.cipher));
  if (ciphered.length === audio.length) return 'all audio formats are signatureCipher (need n-sig decode)';
  return 'unknown — formats present but none usable';
}

export async function getYoutubeStreamUrl(videoId) {
  const errors = [];
  for (const client of CLIENTS) {
    try {
      const data = await fetchInnertube(videoId, client);
      const status = data?.playabilityStatus?.status;
      if (status && status !== 'OK') {
        errors.push(`${client.clientName}: ${data.playabilityStatus.reason || status}`);
        continue;
      }
      const url = pickBestAudioUrl(data?.streamingData);
      if (url) return url;
      errors.push(`${client.clientName}: ${describeStreamingFailure(data?.streamingData)}`);
    } catch (e) {
      errors.push(`${client.clientName}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'all clients failed');
}
