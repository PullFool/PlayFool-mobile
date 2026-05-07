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
function buildExtractionScript(reqId, videoId) {
  const safeId = JSON.stringify(reqId);
  const safeVideoId = JSON.stringify(videoId);
  return `
    (function() {
      var reqId = ${safeId};
      var videoId = ${safeVideoId};
      var clients = [
        { name: 'WEB', version: '2.20250101.01.00', code: 1 },
        { name: 'MWEB', version: '2.20250101.01.00', code: 2 },
        { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', version: '7.20250101.10.00', code: 85 },
        { name: 'WEB_REMIX', version: '1.20250101.01.00', code: 67 },
      ];
      function tryClient(c) {
        var body = {
          videoId: videoId,
          context: { client: { clientName: c.name, clientVersion: c.version, hl: 'en', gl: 'US' } },
          contentCheckOk: true,
          racyCheckOk: true,
        };
        return fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': String(c.code),
            'X-YouTube-Client-Version': c.version,
          },
          body: JSON.stringify(body),
          credentials: 'include',
        }).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(data) {
          var status = data.playabilityStatus && data.playabilityStatus.status;
          if (status && status !== 'OK') {
            throw new Error(data.playabilityStatus.reason || status);
          }
          var formats = (data.streamingData && data.streamingData.adaptiveFormats) || [];
          var audio = formats.filter(function(f) {
            return f.mimeType && f.mimeType.indexOf('audio/') === 0
              && typeof f.url === 'string' && f.url.indexOf('http') === 0;
          });
          if (!audio.length) {
            var ciphered = formats.filter(function(f) {
              return f.mimeType && f.mimeType.indexOf('audio/') === 0
                && (f.signatureCipher || f.cipher);
            });
            if (ciphered.length) throw new Error('only signatureCipher formats');
            throw new Error('no audio formats');
          }
          audio.sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
          return audio[0].url;
        });
      }
      function send(payload) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        } catch (e) {}
      }
      var errors = [];
      function tryNext(i) {
        if (i >= clients.length) {
          send({ id: reqId, error: errors.join(' | ') || 'all clients failed' });
          return;
        }
        tryClient(clients[i]).then(function(url) {
          send({ id: reqId, url: url });
        }).catch(function(e) {
          errors.push(clients[i].name + ': ' + (e && e.message ? e.message : String(e)));
          tryNext(i + 1);
        });
      }
      tryNext(0);
    })();
    true;
  `;
}

// Initial script that just signals to RN that the page has loaded and the
// fetch context is available.
const READY_SCRIPT = `
  (function() {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ ready: true, marker: '${READY_MARKER}' })); } catch (e) {}
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
