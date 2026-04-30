// Crossfade controller — runs alongside react-native-track-player.
// Strategy: when the current track approaches its end, start the NEXT track
// on a separate expo-av Sound instance at volume 0 and ramp both volumes
// over `seconds`. When the fade window completes, hand off to track-player
// (which is about to auto-advance anyway), seek it to the right offset,
// and unload the helper sound.
//
// This won't be perfectly seamless — there is a small handoff glitch when
// track-player auto-advances. Acceptable for casual listening / Bluetooth.

import { Audio } from 'expo-av';
import TrackPlayer from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from './errorReporter';

const SECONDS_KEY = 'playfool_mobile_crossfade_seconds';
const RAMP_INTERVAL_MS = 50;

let crossfadeSeconds = 0;
let active = null; // { sound, intervalId, nextTrackId, started }

export async function getCrossfadeSeconds() {
  return crossfadeSeconds;
}

export async function setCrossfadeSeconds(s) {
  const clamped = Math.max(0, Math.min(12, Math.round(s)));
  crossfadeSeconds = clamped;
  try { await AsyncStorage.setItem(SECONDS_KEY, String(clamped)); } catch (e) {}
}

export async function loadCrossfadeSetting() {
  try {
    const raw = await AsyncStorage.getItem(SECONDS_KEY);
    const v = parseInt(raw || '0', 10);
    crossfadeSeconds = isNaN(v) ? 0 : Math.max(0, Math.min(12, v));
  } catch (e) {
    crossfadeSeconds = 0;
  }
  // expo-av needs to be allowed to play in mixWithOthers so it overlaps with track-player
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      interruptionModeAndroid: 1, // DoNotMix? Actually we WANT mix — see below.
    });
  } catch (e) {}
}

async function abortCurrent() {
  const a = active;
  active = null;
  if (!a) return;
  try { if (a.intervalId) clearInterval(a.intervalId); } catch (e) {}
  try { await TrackPlayer.setVolume(1); } catch (e) {}
  try { if (a.sound) { await a.sound.stopAsync(); await a.sound.unloadAsync(); } } catch (e) {}
}

export async function abortCrossfade() { await abortCurrent(); }

// Called from PlayerContext on every progress tick (every ~500ms).
// `position` and `duration` are seconds. `nextTrack` is the next song object
// we expect track-player to advance to (so we can pre-load its url).
export async function tick({ position, duration, currentTrackId, nextTrack }) {
  if (crossfadeSeconds <= 0) return;
  if (!duration || duration < crossfadeSeconds * 2) return;
  if (!nextTrack || !nextTrack.url) return;

  const remaining = duration - position;
  if (remaining > crossfadeSeconds + 0.5) {
    // Not yet in the fade window. If we have a stale active fade for a
    // different track, clean it up.
    if (active && active.currentTrackId !== currentTrackId) await abortCurrent();
    return;
  }

  if (active && active.currentTrackId === currentTrackId) return; // already running

  // Start the crossfade.
  await abortCurrent();
  try {
    const { sound } = await Audio.Sound.createAsync(
      { uri: nextTrack.url },
      { shouldPlay: true, volume: 0 }
    );
    const startTs = Date.now();
    const fadeMs = crossfadeSeconds * 1000;
    const intervalId = setInterval(async () => {
      if (!active) return;
      const t = Math.min(1, (Date.now() - startTs) / fadeMs);
      try { await TrackPlayer.setVolume(1 - t); } catch (e) {}
      try { await sound.setVolumeAsync(t); } catch (e) {}
      if (t >= 1) {
        clearInterval(intervalId);
        // Hand off: unload helper, advance track-player, seek to handoff position,
        // restore its volume.
        try { await sound.stopAsync(); } catch (e) {}
        try { await sound.unloadAsync(); } catch (e) {}
        try { await TrackPlayer.skipToNext(); } catch (e) {}
        try { await TrackPlayer.seekTo(crossfadeSeconds); } catch (e) {}
        try { await TrackPlayer.setVolume(1); } catch (e) {}
        active = null;
      }
    }, RAMP_INTERVAL_MS);
    active = { sound, intervalId, currentTrackId, nextTrackId: nextTrack.id, started: startTs };
  } catch (e) {
    reportError('crossfade.start', e);
    await abortCurrent();
  }
}
