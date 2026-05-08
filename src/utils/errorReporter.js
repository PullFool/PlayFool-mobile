// Silent error reporter for PlayFool Mobile.
// Captures unhandled JS errors and promise rejections, forwards them to a Discord webhook.
import { Platform } from 'react-native';
import * as Application from 'expo-application';

// Webhook URL is injected at build time via EAS secret EXPO_PUBLIC_DISCORD_WEBHOOK.
// In dev (expo start) this is undefined and error reporting is silently skipped.
const DISCORD_WEBHOOK = process.env.EXPO_PUBLIC_DISCORD_WEBHOOK || '';

// Read the actual installed version from the APK manifest at runtime,
// so error reports always reflect what the user is actually running.
const APP_VERSION = Application.nativeApplicationVersion || 'dev';
const recentErrors = new Map();
const DEDUP_WINDOW_MS = 30000;

// Sources where every error matters — user-triggered actions whose retries
// are rare and diagnostic. We skip the 30s dedup window for these so every
// attempt lands in Discord (otherwise users hit "download" 3x in 30s and
// only the first ever reaches us).
const NO_DEDUP_SOURCES = new Set([
  'download',
  'sync.download',
  'sync.upload',
]);

function sanitize(text) {
  if (!text || typeof text !== 'string') return String(text || '');
  return text
    .replace(/\/data\/user\/0\/[^/]+/g, '/data/user/0/[app]')
    .replace(/\/storage\/emulated\/0\/Android\/data\/[^/]+/g, '/storage/emulated/0/Android/data/[app]')
    .replace(/file:\/\/[^\s)]+/g, 'file://[path]');
}

function send(source, message, stack, extra = {}) {
  if (!message || !DISCORD_WEBHOOK) return;
  const signature = `${source}:${message}`;
  const now = Date.now();
  if (!NO_DEDUP_SOURCES.has(source)) {
    const last = recentErrors.get(signature);
    if (last && now - last < DEDUP_WINDOW_MS) return;
    recentErrors.set(signature, now);
  }

  if (recentErrors.size > 100) {
    for (const [k, t] of recentErrors) {
      if (now - t > DEDUP_WINDOW_MS) recentErrors.delete(k);
    }
  }

  // Discord embed limits we have to respect or the entire send is rejected
  // with HTTP 400 (and our .catch swallows it silently): title <=256,
  // description <=4096, field value <=1024, total <=6000.
  const sanitizedMessage = sanitize(message);
  const shortMessage = sanitizedMessage.replace(/\s+/g, ' ').slice(0, 80);
  const titleText = `${source}: ${shortMessage}`.slice(0, 240);
  const descChunks = ['**' + sanitizedMessage.slice(0, 3500) + '**'];
  if (stack) descChunks.push('```\n' + sanitize(stack).slice(0, 500) + '\n```');
  const description = descChunks.join('\n').slice(0, 4090);

  const payload = {
    username: 'PlayFool Mobile Reporter',
    embeds: [{
      title: titleText,
      description: description,
      color: 15158332,
      fields: [
        { name: 'Source', value: source.slice(0, 200), inline: true },
        { name: 'Version', value: String(APP_VERSION).slice(0, 200), inline: true },
        { name: 'Platform', value: `${Platform.OS} ${Platform.Version}`.slice(0, 200), inline: true },
        ...Object.entries(extra).map(([k, v]) => ({
          name: String(k).slice(0, 200),
          value: String(sanitize(String(v))).slice(0, 1000) || '_empty_',
          inline: false,
        })),
      ],
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (e) { /* silent */ }
}

export function installErrorReporter() {
  // Catch synchronous JS errors via React Native's global error handler
  const ErrorUtils = global.ErrorUtils;
  if (ErrorUtils && typeof ErrorUtils.setGlobalHandler === 'function') {
    const previous = ErrorUtils.getGlobalHandler && ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      try {
        send('global', error?.message || String(error), error?.stack, { fatal: !!isFatal });
      } catch (e) {}
      if (previous) previous(error, isFatal);
    });
  }

  // Catch unhandled promise rejections
  const tracking = require('promise/setimmediate/rejection-tracking');
  if (tracking && typeof tracking.enable === 'function') {
    tracking.enable({
      allRejections: true,
      onUnhandled: (id, error) => {
        send('unhandledrejection', error?.message || String(error), error?.stack);
      },
      onHandled: () => {},
    });
  }

  // Build version info from Expo Application API if available
  try {
    if (Application.nativeApplicationVersion) {
      // overwrite static APP_VERSION with the runtime version
      global.__playfool_version = Application.nativeApplicationVersion;
    }
  } catch (e) {}
}

// Manual reporter for catch blocks if you want to forward an error explicitly
export function reportError(source, error, extra = {}) {
  send(source, error?.message || String(error), error?.stack, extra);
}

// Diagnostic helper. Returns { configured, ok, status, error }. UI can use
// this to show whether the webhook is set up and whether the actual fetch
// succeeds — surfacing what `send()` normally swallows.
export async function testWebhook() {
  if (!DISCORD_WEBHOOK) {
    return { configured: false, ok: false, error: 'EXPO_PUBLIC_DISCORD_WEBHOOK is empty in this build' };
  }
  const payload = {
    username: 'PlayFool Mobile Reporter',
    content: `Webhook test from PlayFool ${APP_VERSION} on ${Platform.OS} ${Platform.Version} at ${new Date().toISOString()}`,
  };
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = res.ok ? '' : await res.text().catch(() => '');
    return {
      configured: true,
      ok: res.ok,
      status: res.status,
      error: res.ok ? '' : `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: `network: ${e?.message || String(e)}`,
    };
  }
}
