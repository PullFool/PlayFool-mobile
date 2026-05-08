// Hidden WebView whose only job is to act as a real Chrome instance running
// at https://www.youtube.com — so any fetch() it makes carries real YouTube
// cookies, visitorData, and a Chrome browser fingerprint.
//
// We pre-warm one WebView at app startup. When the YouTube screen needs a
// stream URL, we inject JS that calls /youtubei/v1/player from inside the
// WebView and bridges the JSON back via window.ReactNativeWebView.postMessage.
//
// This bypasses YouTube's bot wall because our actual fetch traffic comes
// from a normal browser session — not from React Native's networking stack
// which has none of those credentials.

import React, { useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

let webViewRef = null;
let isReady = false;
const pending = new Map();
let nextId = 1;

const READY_MARKER = '__playfool_yt_ready__';

// Extraction script that runs INSIDE the WebView. videoId and reqId are
// injected as JSON-stringified literals for safe escaping.
//
// Strategy: scrape the watch page HTML. YouTube's watch page embeds the full
// playerResponse as `var ytInitialPlayerResponse = {...};` — exactly what
// the browser's own player consumes. Because the WebView already has real
// YouTube cookies + visitor data, the embedded playerResponse for many
// videos contains plain audio URLs (no signatureCipher).
//
// Fallback: /youtubei/v1/player POST using window.ytcfg.data_ for the real
// INNERTUBE_API_KEY and INNERTUBE_CONTEXT (these include visitorData), so
// the request matches what the YouTube web app sends for its own user.
function buildExtractionScript(reqId, videoId) {
  const safeId = JSON.stringify(reqId);
  const safeVideoId = JSON.stringify(videoId);
  return `
    (function() {
      var reqId = ${safeId};
      var videoId = ${safeVideoId};

      function send(payload) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
      }

      // Walk balanced braces to extract a JSON object that follows a marker
      // like 'var ytInitialPlayerResponse = '. Robust against nested braces
      // inside string values.
      function sliceJsonObject(text, startMarker) {
        var idx = text.indexOf(startMarker);
        if (idx === -1) return null;
        var start = text.indexOf('{', idx);
        if (start === -1) return null;
        var depth = 0, inStr = false, escape = false;
        for (var i = start; i < text.length; i++) {
          var c = text.charAt(i);
          if (escape) { escape = false; continue; }
          if (c === '\\\\') { escape = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) return text.substring(start, i + 1);
          }
        }
        return null;
      }

      function pickAudio(streamingData) {
        var formats = (streamingData && streamingData.adaptiveFormats) || [];
        var audio = formats.filter(function(f) {
          return f.mimeType && f.mimeType.indexOf('audio/') === 0
            && typeof f.url === 'string' && f.url.indexOf('http') === 0;
        });
        if (!audio.length) {
          var ciphered = formats.filter(function(f) {
            return f.mimeType && f.mimeType.indexOf('audio/') === 0
              && (f.signatureCipher || f.cipher);
          });
          if (ciphered.length) throw new Error('only signatureCipher (need n-decode)');
          throw new Error('no audio formats');
        }
        audio.sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        return audio[0].url;
      }

      // ---- Method 1: scrape /watch HTML ----
      // Use a relative URL so we stay same-origin regardless of whether
      // YouTube redirected our WebView to m.youtube.com or kept us on
      // www.youtube.com.
      function viaWatchPage() {
        return fetch('/watch?v=' + encodeURIComponent(videoId), {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        }).then(function(r) {
          if (!r.ok) throw new Error('watch HTTP ' + r.status);
          return r.text();
        }).then(function(html) {
          var json = sliceJsonObject(html, 'ytInitialPlayerResponse');
          if (!json) throw new Error('no ytInitialPlayerResponse in HTML');
          var pr = JSON.parse(json);
          var status = pr.playabilityStatus && pr.playabilityStatus.status;
          if (status && status !== 'OK') throw new Error(pr.playabilityStatus.reason || status);
          return pickAudio(pr.streamingData);
        });
      }

      // ---- Method 2: /youtubei/v1/player POST with ytcfg-derived context ----
      // ytcfg can live in different places depending on the YT page variant.
      // Try the documented spots in order.
      function readYtcfg() {
        if (window.ytcfg && window.ytcfg.data_) return window.ytcfg.data_;
        if (window.ytcfg && typeof window.ytcfg.get === 'function') {
          try {
            return {
              INNERTUBE_API_KEY: window.ytcfg.get('INNERTUBE_API_KEY'),
              INNERTUBE_CONTEXT: window.ytcfg.get('INNERTUBE_CONTEXT'),
              INNERTUBE_CONTEXT_CLIENT_NAME: window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME'),
            };
          } catch (e) { /* fall through */ }
        }
        return null;
      }
      function viaInnertube() {
        var cfg = readYtcfg();
        if (!cfg) return Promise.reject(new Error('no ytcfg'));
        var apiKey = cfg.INNERTUBE_API_KEY;
        var ctx = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !ctx) return Promise.reject(new Error('ytcfg missing api key or context'));
        var body = {
          videoId: videoId,
          context: ctx,
          contentCheckOk: true,
          racyCheckOk: true,
          playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
        };
        return fetch('/youtubei/v1/player?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': String(cfg.INNERTUBE_CONTEXT_CLIENT_NAME || 1),
            'X-YouTube-Client-Version': (ctx.client && ctx.client.clientVersion) || '2.20250101.01.00',
          },
          body: JSON.stringify(body),
        }).then(function(r) {
          if (!r.ok) throw new Error('innertube HTTP ' + r.status);
          return r.json();
        }).then(function(data) {
          var status = data.playabilityStatus && data.playabilityStatus.status;
          if (status && status !== 'OK') throw new Error(data.playabilityStatus.reason || status);
          return pickAudio(data.streamingData);
        });
      }

      // Try methods in order. Collect each error so the user sees what failed.
      var errors = [];
      viaWatchPage().then(function(url) {
        send({ id: reqId, url: url });
      }).catch(function(e1) {
        errors.push('watch: ' + (e1 && e1.message ? e1.message : String(e1)));
        viaInnertube().then(function(url) {
          send({ id: reqId, url: url });
        }).catch(function(e2) {
          errors.push('innertube: ' + (e2 && e2.message ? e2.message : String(e2)));
          send({ id: reqId, error: errors.join(' | ') });
        });
      });
    })();
    true;
  `;
}

// Initial script that polls the page until ytcfg appears (or a timeout
// elapses), then signals readiness. Just firing on onLoadEnd is too early —
// the watch page's ytInitialPlayerResponse and ytcfg.data_ are populated
// after additional inline scripts run.
const READY_SCRIPT = `
  (function() {
    var deadline = Date.now() + 15000;
    function check() {
      var hasCfg = !!(window.ytcfg && (window.ytcfg.data_ || (typeof window.ytcfg.get === 'function' && window.ytcfg.get('INNERTUBE_API_KEY'))));
      if (hasCfg || Date.now() > deadline) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            ready: true,
            marker: '${READY_MARKER}',
            ytcfg: !!hasCfg,
            origin: window.location.origin,
          }));
        } catch (e) {}
        return;
      }
      setTimeout(check, 250);
    }
    check();
  })();
  true;
`;

export function isWebViewExtractorReady() {
  return isReady;
}

export function extractStreamUrlViaWebView(videoId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    if (!webViewRef) {
      reject(new Error('WebView not mounted'));
      return;
    }
    if (!isReady) {
      reject(new Error('WebView not ready yet (still loading youtube.com)'));
      return;
    }
    const id = String(nextId++);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('WebView extraction timed out'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      webViewRef.injectJavaScript(buildExtractionScript(id, videoId));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
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
      isReady = true;
      return;
    }
    if (!data || data.id == null) return;
    const entry = pending.get(String(data.id));
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(String(data.id));
    if (data.url) entry.resolve(data.url);
    else entry.reject(new Error(data.error || 'unknown extraction failure'));
  }, []);

  useEffect(() => {
    webViewRef = ref.current;
    return () => { webViewRef = null; isReady = false; };
  }, []);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ uri: 'https://www.youtube.com/' }}
        // Force the desktop YT site so the page ships with ytInitialPlayerResponse
        // and window.ytcfg. Without an override, Android WebView's default UA
        // makes YouTube redirect to m.youtube.com, which has neither.
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
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
