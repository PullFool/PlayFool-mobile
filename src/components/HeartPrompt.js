import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import SupportModal from './SupportModal';
import { recordHeart, hasHearted, HEARTED_KEY } from '../utils/hearts';

const LAUNCH_COUNT_KEY = 'playfool_mobile_launch_count';
const PROMPT_SEEN_KEY = 'playfool_mobile_heart_prompt_seen';

// Tracks how many times the app has been opened and shows the heart/support
// modal automatically on the 2nd launch — but only once. If the user already
// tapped the heart on Settings, skip the auto-prompt entirely.
export default function HeartPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await hasHearted()) return;
        const seen = await AsyncStorage.getItem(PROMPT_SEEN_KEY);
        if (seen === '1') return;

        const raw = await AsyncStorage.getItem(LAUNCH_COUNT_KEY);
        const count = (parseInt(raw || '0', 10) || 0) + 1;
        try { await AsyncStorage.setItem(LAUNCH_COUNT_KEY, String(count)); } catch (e) {}

        if (count >= 2 && !cancelled) {
          // Mark prompt as shown immediately so a quick close-and-reopen doesn't
          // double-fire it.
          try { await AsyncStorage.setItem(PROMPT_SEEN_KEY, '1'); } catch (e) {}
          // Small delay so the prompt feels deliberate, not instant on launch.
          setTimeout(() => { if (!cancelled) setShow(true); }, 800);
        }
      } catch (e) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLike = async () => {
    const version = Application.nativeApplicationVersion || 'dev';
    await recordHeart(version);
  };

  return <SupportModal open={show} onClose={() => setShow(false)} onLike={handleLike} />;
}
