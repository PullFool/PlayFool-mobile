// JS bridge for the native PlayFoolEq module.
// Wraps android.media.audiofx.Equalizer attached to the global output mix.
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from './errorReporter';

const { PlayFoolEq } = NativeModules;
const ENABLED_KEY = 'playfool_mobile_eq_enabled';
const LEVELS_KEY = 'playfool_mobile_eq_levels';

export const EQ_AVAILABLE = !!PlayFoolEq;

export async function describeEq() {
  if (!PlayFoolEq) return null;
  try {
    return await PlayFoolEq.describe();
  } catch (e) {
    reportError('eq.describe', e);
    return null;
  }
}

export async function setEqEnabled(enabled) {
  if (!PlayFoolEq) return;
  try { await PlayFoolEq.setEnabled(!!enabled); } catch (e) { reportError('eq.enable', e); }
  try { await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch (e) {}
}

export async function setEqLevels(levels) {
  if (!PlayFoolEq) return;
  try { await PlayFoolEq.setBandLevels(levels); } catch (e) { reportError('eq.setLevels', e); }
  try { await AsyncStorage.setItem(LEVELS_KEY, JSON.stringify(levels)); } catch (e) {}
}

export async function setEqBand(index, millibels) {
  if (!PlayFoolEq) return;
  try { await PlayFoolEq.setBandLevel(index, millibels); } catch (e) { reportError('eq.setBand', e); }
}

export async function resetEq() {
  if (!PlayFoolEq) return;
  try { await PlayFoolEq.reset(); } catch (e) { reportError('eq.reset', e); }
  try { await AsyncStorage.removeItem(LEVELS_KEY); } catch (e) {}
}

// Restore the saved EQ on app start. Call once after PlayerProvider mounts.
export async function restoreEq() {
  if (!PlayFoolEq) return;
  try {
    const enabledRaw = await AsyncStorage.getItem(ENABLED_KEY);
    const enabled = enabledRaw === null ? true : enabledRaw === '1';
    await PlayFoolEq.setEnabled(enabled);
    const levelsRaw = await AsyncStorage.getItem(LEVELS_KEY);
    if (levelsRaw) {
      const levels = JSON.parse(levelsRaw);
      if (Array.isArray(levels) && levels.length) {
        await PlayFoolEq.setBandLevels(levels);
      }
    }
  } catch (e) {
    reportError('eq.restore', e);
  }
}

export function formatFreq(centerMilliHz) {
  const hz = Math.round(centerMilliHz / 1000);
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`;
  return `${hz}`;
}
