// Hidden WebView that mints a YouTube PoToken via bgutils-js (running
// BotGuard inside a real Chrome context at youtube.com), then uses that
// PoToken in Innertube /player requests so YouTube returns plain audio
// URLs instead of signatureCipher-only formats.
//
// PoToken pipeline:
//   1. WebView loads https://www.youtube.com/ with desktop UA. Cookies
//      and visitorData accumulate in a real browser session.
//   2. injectedJavaScript loads our bundled bgutils-js IIFE → window.BG.
//   3. After page-load we inject a minting script that calls
//      BG.Challenge.create + BG.PoToken.generate, and bridges the resulting
//      { poToken, visitorData } back to RN.
//   4. We cache (poToken, visitorData) for 10 minutes — long enough to
//      cover a download burst, short enough to refresh before YT considers
//      the token stale.
//   5. extractStreamUrlViaWebView(videoId) injects a script that POSTs to
//      /youtubei/v1/player with serviceIntegrityDimensions.poToken set;
//      YouTube returns plain-URL adaptiveFormats and we resolve.

import React, { useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { BGUTILS_CODE } from '../generated/bgutilsBundle';

let webViewRef = null;
let isPageReady = false;
let cachedPoToken = '';
let cachedVisitorData = '';
let poTokenExpiresAt = 0;
let mintInFlight = null;
const pending = new Map();
let nextId = 1;

const READY_MARKER = '__playfool_yt_ready__';
const POTOKEN_TTL_MS = 10 * 60 * 1000;
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'; // YouTube's well-known BotGuard request key

// Initial readiness signal: page has loaded AND ytcfg is available AND the
// bgutils bundle has set window.BG. Polls because all three settle async.
const READY_SCRIPT = `
  (function() {
    var deadline = Date.now() + 20000;
    function ready() {
      var hasCfg = !!(window.ytcfg && (window.ytcfg.data_ || (typeof window.ytcfg.get === 'function' && window.ytcfg.get('INNERTUBE_API_KEY'))));
      var hasBG = typeof window.BG !== 'undefined';
      if ((hasCfg && hasBG) || Date.now() > deadline) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            ready: true,
            marker: '${READY_MARKER}',
            ytcfg: !!hasCfg,
            bg: !!hasBG,
            origin: window.location.origin,
          }));
        } catch (e) {}
        return;
      }
      setTimeout(ready, 250);
    }
    ready();
  })();
  true;
`;

function readVisitorDataScript() {
  return `
    (function() {
      try {
        var cfg = (window.ytcfg && window.ytcfg.data_) || null;
        if (!cfg && window.ytcfg && typeof window.ytcfg.get === 'function') {
          cfg = { INNERTUBE_CONTEXT: window.ytcfg.get('INNERTUBE_CONTEXT') };
        }
        var ctx = cfg && cfg.INNERTUBE_CONTEXT;
        var visitorData = ctx && ctx.client && ctx.client.visitorData;
        window.__playfool_visitorData = visitorData || '';
      } catch (e) { window.__playfool_visitorData = ''; }
    })();
    true;
  `;
}

function buildMintScript(reqId) {
  return `
    (async function() {
      var reqId = ${JSON.stringify(reqId)};
      function send(payload) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
      }
      try {
        if (typeof window.BG === 'undefined') throw new Error('BG missing on window');
        var cfg = (window.ytcfg && window.ytcfg.data_) || null;
        if (!cfg && window.ytcfg && typeof window.ytcfg.get === 'function') {
          cfg = { INNERTUBE_CONTEXT: window.ytcfg.get('INNERTUBE_CONTEXT') };
        }
        var ctx = cfg && cfg.INNERTUBE_CONTEXT;
        var visitorData = (ctx && ctx.client && ctx.client.visitorData) || '';
        if (!visitorData) throw new Error('no visitorData in ytcfg');

        var bgConfig = {
          fetch: function(input, init) { return fetch(input, init); },
          globalObj: window,
          requestKey: ${JSON.stringify(REQUEST_KEY)},
          identifier: visitorData,
        };

        var challenge = await window.BG.Challenge.create(bgConfig);
        if (!challenge) throw new Error('Challenge.create returned null');

        var interp = challenge.interpreterJavascript && challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
        if (interp) new Function(interp)();

        var poTokenResult = await window.BG.PoToken.generate({
          program: challenge.program,
          globalName: challenge.globalName,
          bgConfig: bgConfig,
        });

        if (!poTokenResult || !poTokenResult.poToken) throw new Error('PoToken.generate returned no token');

        send({ id: reqId, kind: 'mint', poToken: poTokenResult.poToken, visitorData: visitorData });
      } catch (e) {
        send({ id: reqId, kind: 'mint', error: (e && e.message) ? e.message : String(e) });
      }
    })();
    true;
  `;
}

function buildExtractionScript(reqId, videoId, poToken, visitorData) {
  return `
    (function() {
      var reqId = ${JSON.stringify(reqId)};
      var videoId = ${JSON.stringify(videoId)};
      var poToken = ${JSON.stringify(poToken)};
      var visitorData = ${JSON.stringify(visitorData)};
      function send(payload) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
      }
      function pickAudio(streamingData) {
        if (!streamingData) throw new Error('no streamingData');
        var adaptive = streamingData.adaptiveFormats || [];
        var combined = streamingData.formats || [];
        var audio = adaptive.filter(function(f) {
          return f.mimeType && f.mimeType.indexOf('audio/') === 0
            && typeof f.url === 'string' && f.url.indexOf('http') === 0;
        });
        if (audio.length) {
          audio.sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
          return audio[0].url;
        }
        var combinedPlayable = combined.filter(function(f) {
          return typeof f.url === 'string' && f.url.indexOf('http') === 0;
        });
        if (combinedPlayable.length) {
          combinedPlayable.sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
          return combinedPlayable[0].url;
        }
        var anyCiphered = adaptive.concat(combined).some(function(f) { return f.signatureCipher || f.cipher; });
        if (anyCiphered) throw new Error('only signatureCipher despite PoToken');
        throw new Error('no playable formats');
      }

      var cfg = (window.ytcfg && window.ytcfg.data_) || null;
      if (!cfg && window.ytcfg && typeof window.ytcfg.get === 'function') {
        cfg = {
          INNERTUBE_API_KEY: window.ytcfg.get('INNERTUBE_API_KEY'),
          INNERTUBE_CONTEXT: window.ytcfg.get('INNERTUBE_CONTEXT'),
          INNERTUBE_CONTEXT_CLIENT_NAME: window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME'),
        };
      }
      var apiKey = cfg && cfg.INNERTUBE_API_KEY;
      var ctx = cfg && cfg.INNERTUBE_CONTEXT;
      if (!apiKey || !ctx) {
        send({ id: reqId, error: 'ytcfg missing api key or context' });
        return;
      }
      // Inject PoToken's visitor data so the request is consistent with the
      // session that minted the token.
      if (ctx.client) ctx.client.visitorData = visitorData || ctx.client.visitorData;

      var body = {
        videoId: videoId,
        context: ctx,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
        serviceIntegrityDimensions: { poToken: poToken },
      };
      fetch('/youtubei/v1/player?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Visitor-Id': visitorData || '',
          'X-YouTube-Client-Name': String((cfg && cfg.INNERTUBE_CONTEXT_CLIENT_NAME) || 1),
          'X-YouTube-Client-Version': (ctx.client && ctx.client.clientVersion) || '2.20250101.01.00',
        },
        body: JSON.stringify(body),
      }).then(function(r) {
        if (!r.ok) throw new Error('player HTTP ' + r.status);
        return r.json();
      }).then(function(data) {
        var status = data.playabilityStatus && data.playabilityStatus.status;
        if (status && status !== 'OK') throw new Error(data.playabilityStatus.reason || status);
        send({ id: reqId, kind: 'extract', url: pickAudio(data.streamingData) });
      }).catch(function(e) {
        send({ id: reqId, kind: 'extract', error: (e && e.message) ? e.message : String(e) });
      });
    })();
    true;
  `;
}

function isCachedPoTokenFresh() {
  return !!cachedPoToken && Date.now() < poTokenExpiresAt;
}

function mintPoToken() {
  if (mintInFlight) return mintInFlight;
  if (!webViewRef || !isPageReady) {
    return Promise.reject(new Error('WebView not ready'));
  }
  const reqId = 'mint-' + (nextId++);
  mintInFlight = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      mintInFlight = null;
      reject(new Error('PoToken mint timed out'));
    }, 30000);
    pending.set(reqId, {
      resolve: (data) => {
        clearTimeout(timer);
        cachedPoToken = data.poToken;
        cachedVisitorData = data.visitorData;
        poTokenExpiresAt = Date.now() + POTOKEN_TTL_MS;
        mintInFlight = null;
        resolve(data);
      },
      reject: (e) => {
        clearTimeout(timer);
        mintInFlight = null;
        reject(e);
      },
      timer,
    });
    try {
      webViewRef.injectJavaScript(buildMintScript(reqId));
    } catch (e) {
      pending.delete(reqId);
      clearTimeout(timer);
      mintInFlight = null;
      reject(e);
    }
  });
  return mintInFlight;
}

export function isWebViewExtractorReady() {
  return isPageReady;
}

export async function extractStreamUrlViaWebView(videoId, timeoutMs = 25000) {
  if (!webViewRef) throw new Error('WebView not mounted');
  if (!isPageReady) throw new Error('WebView not ready (still loading)');
  if (!isCachedPoTokenFresh()) {
    await mintPoToken();
  }
  return new Promise((resolve, reject) => {
    const reqId = 'ext-' + (nextId++);
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('extraction timed out'));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });
    try {
      webViewRef.injectJavaScript(buildExtractionScript(reqId, videoId, cachedPoToken, cachedVisitorData));
    } catch (e) {
      pending.delete(reqId);
      clearTimeout(timer);
      reject(e);
    }
  });
}

export default function HiddenYouTubeWebView() {
  const ref = useRef(null);

  const handleMessage = useCallback((event) => {
    let data;
    try { data = JSON.parse(event.nativeEvent.data); } catch (e) { return; }
    if (data && data.ready && data.marker === READY_MARKER) {
      isPageReady = !!(data.ytcfg && data.bg);
      // Pre-warm a PoToken in the background as soon as the WebView is
      // fully ready, so the first download doesn't pay for the BotGuard
      // round-trip on top of the actual extract.
      if (isPageReady) {
        mintPoToken().catch(() => { /* will retry on first extract */ });
      }
      return;
    }
    if (!data || data.id == null) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.kind === 'mint') {
      if (data.error) entry.reject(new Error('mint: ' + data.error));
      else entry.resolve({ poToken: data.poToken, visitorData: data.visitorData });
      return;
    }
    // extraction
    clearTimeout(entry.timer);
    if (data.url) entry.resolve(data.url);
    else entry.reject(new Error(data.error || 'unknown extraction failure'));
  }, []);

  useEffect(() => {
    webViewRef = ref.current;
    return () => {
      webViewRef = null;
      isPageReady = false;
      cachedPoToken = '';
      cachedVisitorData = '';
      poTokenExpiresAt = 0;
    };
  }, []);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ uri: 'https://www.youtube.com/' }}
        // Force desktop YT site so the page ships with ytInitialPlayerResponse
        // and ytcfg. Default Android WebView UA triggers the m.youtube.com
        // redirect, which has neither.
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        // Preload bgutils-js so window.BG is available before YT scripts run.
        injectedJavaScriptBeforeContentLoaded={BGUTILS_CODE + '\ntrue;'}
        onMessage={handleMessage}
        onLoadEnd={() => {
          if (ref.current) ref.current.injectJavaScript(READY_SCRIPT);
        }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        mixedContentMode="always"
        originWhitelist={['*']}
        cacheEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});
