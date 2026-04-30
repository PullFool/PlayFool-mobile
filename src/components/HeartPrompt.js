import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import SupportModal from './SupportModal';
import {
  recordHeart, hasHearted, hasDonated, markDonated,
  isPromptOptOut, setPromptOptOut,
} from '../utils/hearts';

const LAUNCH_COUNT_KEY = 'playfool_mobile_launch_count';

// Prompts the heart/donate modal on a fading cadence so we don't pester users:
//   - Launch 2:  show once  (catch them after they've tried the app)
//   - Launch 12, 22, 32, ...: show again if they still haven't donated (every 10 thereafter)
//   - Tapping 'Don't ask again' in the modal silences it forever
//   - Marking donated (tapping 'Yes, support on Ko-fi') silences it forever
export default function HeartPrompt() {
  const [show, setShow] = useState(false);
  const [alreadyHearted, setAlreadyHearted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await hasDonated()) return;
        if (await isPromptOptOut()) return;
        const hearted = await hasHearted();
        if (cancelled) return;
        setAlreadyHearted(hearted);

        const raw = await AsyncStorage.getItem(LAUNCH_COUNT_KEY);
        const count = (parseInt(raw || '0', 10) || 0) + 1;
        try { await AsyncStorage.setItem(LAUNCH_COUNT_KEY, String(count)); } catch (e) {}

        // Show on launch 2, then every 10 after that (12, 22, 32, ...)
        const shouldShow = count === 2 || (count > 2 && (count - 2) % 10 === 0);
        if (shouldShow) {
          setTimeout(() => { if (!cancelled) setShow(true); }, 1200);
        }
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const handleLike = async () => {
    const version = Application.nativeApplicationVersion || 'dev';
    await recordHeart(version);
    setAlreadyHearted(true);
  };

  const handleDonate = async () => {
    // User tapped 'Yes, support on Ko-fi'. Stop prompting forever.
    await markDonated();
  };

  const handleDontAskAgain = async () => {
    await setPromptOptOut();
    setShow(false);
  };

  return (
    <SupportModal
      open={show}
      alreadyHearted={alreadyHearted}
      onLike={handleLike}
      onDonate={handleDonate}
      onDontAskAgain={handleDontAskAgain}
      onClose={() => setShow(false)}
    />
  );
}
