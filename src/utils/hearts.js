// Hearts API client — used by the Settings tap and the launch-count prompt.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from './errorReporter';

const HEARTS_API = 'https://adrianborboran.up.railway.app/api/hearts';
const INSTALL_KEY = 'playfool_mobile_install_id';
export const HEARTED_KEY = 'playfool_mobile_hearted';

export async function getInstallId() {
  let id = await AsyncStorage.getItem(INSTALL_KEY);
  if (!id) {
    id = `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { await AsyncStorage.setItem(INSTALL_KEY, id); } catch (e) {}
  }
  return id;
}

export async function recordHeart(appVersion = '1.0.0') {
  try {
    const install_id = await getInstallId();
    await fetch(HEARTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        project: 'playfool-mobile',
        install_id,
        app_version: appVersion,
        platform: 'android',
      }),
    });
    try { await AsyncStorage.setItem(HEARTED_KEY, '1'); } catch (e) {}
  } catch (e) {
    reportError('hearts.record', e);
  }
}

export async function hasHearted() {
  return (await AsyncStorage.getItem(HEARTED_KEY)) === '1';
}

const DONATED_KEY = 'playfool_mobile_donated';
export const DONATED_STORAGE_KEY = DONATED_KEY;

export async function hasDonated() {
  return (await AsyncStorage.getItem(DONATED_KEY)) === '1';
}

export async function markDonated() {
  try { await AsyncStorage.setItem(DONATED_KEY, '1'); } catch (e) {}
}

const PROMPT_OPT_OUT_KEY = 'playfool_mobile_prompt_optout';

export async function isPromptOptOut() {
  return (await AsyncStorage.getItem(PROMPT_OPT_OUT_KEY)) === '1';
}

export async function setPromptOptOut() {
  try { await AsyncStorage.setItem(PROMPT_OPT_OUT_KEY, '1'); } catch (e) {}
}
