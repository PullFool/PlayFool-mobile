// Volume normalization for PlayFool Mobile.
// Mirrors what the desktop's ffmpeg loudnorm pass does: re-encodes each MP3
// to -14 LUFS (Spotify's target) so the whole library plays at a consistent
// perceived loudness. A normalized-files set in AsyncStorage prevents
// re-processing on repeat plays.
//
// Two file sources to handle:
//   - SAF (content://) URIs from the user-picked PlayFool folder. ffmpeg-kit
//     reads/writes these via FFmpegKitConfig.getSafParameter*.
//   - file:// or asset:// URIs from MediaStore (legacy). Handled by giving
//     ffmpeg the plain filesystem path and atomically moving the tmp output
//     over the original.

import { FFmpegKit, FFmpegKitConfig, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NORM_KEY = 'playfool_mobile_normalized';
const TARGET = '-14';
const TRUE_PEAK = '-1.5';
const RANGE = '11';

let cachedSet = null;
async function loadNormalizedSet() {
  if (cachedSet) return cachedSet;
  try {
    const raw = await AsyncStorage.getItem(NORM_KEY);
    cachedSet = new Set(raw ? JSON.parse(raw) : []);
  } catch (e) { cachedSet = new Set(); }
  return cachedSet;
}

async function saveNormalizedSet() {
  if (!cachedSet) return;
  try {
    await AsyncStorage.setItem(NORM_KEY, JSON.stringify([...cachedSet]));
  } catch (e) {}
}

export async function isNormalized(uri) {
  if (!uri) return false;
  const set = await loadNormalizedSet();
  return set.has(uri);
}

async function markNormalized(uri) {
  const set = await loadNormalizedSet();
  set.add(uri);
  await saveNormalizedSet();
}

export async function getNormalizationCount(allUris) {
  const set = await loadNormalizedSet();
  let n = 0;
  for (const u of allUris) if (set.has(u)) n++;
  return n;
}

// Run ffmpeg loudnorm on a single song. Returns { ok, skipped, error }.
// Fire-and-forget callers can ignore the return value.
export async function normalizeAudio(uri) {
  if (!uri) return { ok: false, error: 'no uri' };
  if (await isNormalized(uri)) return { skipped: true };

  const isSaf = uri.startsWith('content://');
  let inputArg;
  let outputArg;
  let cleanup = async () => {};

  try {
    if (isSaf) {
      // ffmpeg-kit turns the content:// URI into a pipe-style path it can
      // read/write through Android's SAF — the actual storage stays in the
      // user's chosen folder.
      inputArg = await FFmpegKitConfig.getSafParameterForRead(uri);
      outputArg = await FFmpegKitConfig.getSafParameterForWrite(uri);
    } else {
      const inputPath = uri.replace(/^file:\/\//, '');
      const tmpPath = `${FileSystem.cacheDirectory}normalize-${Date.now()}.mp3`;
      const tmpRaw = tmpPath.replace(/^file:\/\//, '');
      inputArg = inputPath;
      outputArg = tmpRaw;
      cleanup = async () => {
        try {
          // Move the normalized temp file over the original, then drop the
          // cache entry. Done outside ffmpeg-kit so we know the encode is
          // committed before touching the original.
          await FileSystem.copyAsync({ from: tmpPath, to: uri });
          await FileSystem.deleteAsync(tmpPath, { idempotent: true });
        } catch (e) {}
      };
    }

    const cmd = [
      '-y',
      '-i', `"${inputArg}"`,
      '-af', `loudnorm=I=${TARGET}:TP=${TRUE_PEAK}:LRA=${RANGE}`,
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-map_metadata', '0',
      '-id3v2_version', '3',
      '-metadata', 'comment=PlayFool-Normalized',
      `"${outputArg}"`,
    ].join(' ');

    const session = await FFmpegKit.execute(cmd);
    const code = await session.getReturnCode();
    if (!ReturnCode.isSuccess(code)) {
      return { ok: false, error: `ffmpeg returned ${code}` };
    }

    if (!isSaf) await cleanup();
    await markNormalized(uri);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Batch state — exposed so the Settings screen can render a progress bar.
let batchState = {
  running: false,
  total: 0,
  done: 0,
  currentFile: '',
  error: '',
};
const batchListeners = new Set();
function emit() {
  for (const fn of batchListeners) {
    try { fn({ ...batchState }); } catch (e) {}
  }
}

export function subscribeBatch(fn) {
  batchListeners.add(fn);
  fn({ ...batchState });
  return () => batchListeners.delete(fn);
}

export function getBatchState() {
  return { ...batchState };
}

// Normalize every song that hasn't been processed yet. Fire-and-forget;
// listeners get progress updates through subscribeBatch.
export async function runBatchNormalize(songs) {
  if (batchState.running) return;
  batchState = { running: true, total: 0, done: 0, currentFile: '', error: '' };
  emit();
  try {
    const set = await loadNormalizedSet();
    const pending = (songs || []).filter((s) => s.url && !set.has(s.url));
    batchState.total = pending.length;
    emit();
    for (const song of pending) {
      batchState.currentFile = song.title || song.url;
      emit();
      try { await normalizeAudio(song.url); }
      catch (e) { /* keep going — one failure shouldn't stop the run */ }
      batchState.done++;
      emit();
    }
    batchState.currentFile = '';
  } catch (e) {
    batchState.error = e?.message || String(e);
  } finally {
    batchState.running = false;
    emit();
  }
}
