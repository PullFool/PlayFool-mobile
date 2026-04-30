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
