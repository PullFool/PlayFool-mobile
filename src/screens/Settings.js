import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { theme } from '../utils/theme';
import SupportModal from '../components/SupportModal';
import EqScreen from './EqScreen';
import SyncScreen from './SyncScreen';
import { recordHeart, HEARTED_KEY as HEART_KEY } from '../utils/hearts';
import { EQ_AVAILABLE } from '../utils/eq';
import { setCrossfadeSeconds } from '../utils/crossfade';

const KOFI_URL = 'https://ko-fi.com/PullFool';

export default function Settings() {
  const [showSupport, setShowSupport] = useState(false);
  const [showEq, setShowEq] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [hasHearted, setHasHearted] = useState(false);
  const [crossfade, setCrossfade] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(HEART_KEY).then((v) => setHasHearted(v === '1'));
    AsyncStorage.getItem('playfool_mobile_crossfade_seconds').then((v) => {
      const n = parseInt(v || '0', 10);
      setCrossfade(isNaN(n) ? 0 : n);
    });
  }, []);

  const onCrossfadeChange = (s) => {
    setCrossfade(s);
    setCrossfadeSeconds(s);
  };

  const onHeartTap = () => setShowSupport(true);

  const handleLike = async () => {
    const version = Application.nativeApplicationVersion || 'dev';
    await recordHeart(version); // also writes HEART_KEY
    setHasHearted(true);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.label}>About PlayFool</Text>
        <Text style={styles.help}>
          Free, ad-free music player with built-in YouTube search and download.{'\n\n'}
          Downloaded MP3s and your phone's existing audio files all live in My Music.
        </Text>
      </View>

      <View style={[styles.section, { borderColor: theme.red, borderWidth: 1 }]}>
        <Text style={[styles.label, { color: theme.red }]}>⚠ Before uninstalling</Text>
        <Text style={styles.help}>
          Android automatically deletes audio files PlayFool created when the app
          is uninstalled — this is a system-level behavior we can't override.
          {'\n\n'}
          To keep your library: open Sync and back up your songs to your PC first.
          Reinstall later, sync again, library restored.
        </Text>
      </View>

      {EQ_AVAILABLE ? (
        <View style={styles.section}>
          <Text style={styles.label}>Equalizer</Text>
          <Text style={styles.help}>System graphic equalizer with presets. Affects all music output. Band count depends on your device (Android's built-in EQ is typically 5 bands).</Text>
          <TouchableOpacity style={styles.themeBtn} onPress={() => setShowEq(true)}>
            <Ionicons name="options" size={16} color={theme.textPrimary} />
            <Text style={styles.themeBtnText}>Open Equalizer</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>Sync with PC</Text>
        <Text style={styles.help}>
          Pair this phone with PlayFool on your PC over Wi-Fi to share downloaded songs.
        </Text>
        <TouchableOpacity style={styles.themeBtn} onPress={() => setShowSync(true)}>
          <Ionicons name="sync" size={16} color={theme.textPrimary} />
          <Text style={styles.themeBtnText}>Open Sync</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Crossfade</Text>
        <Text style={styles.help}>
          Overlap the end of one song with the start of the next. Set to 0 to disable.
        </Text>
        <View style={styles.crossfadeRow}>
          {[0, 2, 4, 6, 8, 10, 12].map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => onCrossfadeChange(s)}
              style={[styles.cfPill, crossfade === s && styles.cfPillActive]}
            >
              <Text style={[styles.cfPillText, crossfade === s && styles.cfPillTextActive]}>
                {s === 0 ? 'Off' : `${s}s`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Support PlayFool</Text>
        <Text style={styles.help}>
          PlayFool is built with love and is completely free. If you enjoy it, your support keeps it going.
        </Text>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.heartBtn, hasHearted && styles.heartBtnActive]}
            onPress={onHeartTap}
          >
            <Ionicons name="heart" size={18} color="#fff" />
            <Text style={styles.heartBtnText}>
              {hasHearted ? 'Thanks for the love' : 'Show some love'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.kofiBtn} onPress={() => Linking.openURL(KOFI_URL)}>
            <Text style={styles.kofiBtnText}>☕ Ko-fi</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.footer}>
        Made by PullFool · v{Application.nativeApplicationVersion || 'dev'}
      </Text>

      <SupportModal
        open={showSupport}
        alreadyHearted={hasHearted}
        onClose={() => setShowSupport(false)}
        onLike={handleLike}
      />

      <EqScreen visible={showEq} onClose={() => setShowEq(false)} />
      <SyncScreen visible={showSync} onClose={() => setShowSync(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bgPrimary, padding: 16 },
  heading: { color: theme.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  section: { backgroundColor: theme.bgCard, borderRadius: 8, padding: 16, marginBottom: 16 },
  label: { color: theme.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  help: { color: theme.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  heartBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.red, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  heartBtnActive: { opacity: 0.85 },
  heartBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  kofiBtn: { backgroundColor: '#13c3ff', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  kofiBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  themeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.bgSurface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, alignSelf: 'flex-start' },
  themeBtnText: { color: theme.textPrimary, fontWeight: '600', fontSize: 13 },
  footer: { color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 24, marginBottom: 40 },
  crossfadeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cfPill: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16,
    backgroundColor: theme.bgSurface, borderWidth: 1, borderColor: theme.border,
  },
  cfPillActive: { backgroundColor: theme.green, borderColor: theme.green },
  cfPillText: { color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
  cfPillTextActive: { color: '#000' },
});
