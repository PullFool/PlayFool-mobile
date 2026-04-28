import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme, useTheme } from '../utils/theme';
import SupportModal from '../components/SupportModal';
import { reportError } from '../utils/errorReporter';

const KOFI_URL = 'https://ko-fi.com/PullFool';
const HEARTS_API = 'https://adrianborboran.up.railway.app/api/hearts';
const HEART_KEY = 'playfool_mobile_hearted';
const INSTALL_KEY = 'playfool_mobile_install_id';

async function getInstallId() {
  let id = await AsyncStorage.getItem(INSTALL_KEY);
  if (!id) {
    id = `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { await AsyncStorage.setItem(INSTALL_KEY, id); } catch (e) {}
  }
  return id;
}

async function recordHeart() {
  try {
    const install_id = await getInstallId();
    await fetch(HEARTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        project: 'playfool-mobile',
        install_id,
        app_version: '1.0.0',
        platform: 'android',
      }),
    });
  } catch (e) {
    reportError('hearts.record', e);
  }
}

export default function Settings() {
  const { mode, toggle } = useTheme();
  const [showSupport, setShowSupport] = useState(false);
  const [hasHearted, setHasHearted] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(HEART_KEY).then((v) => setHasHearted(v === '1'));
  }, []);

  const onHeartTap = () => setShowSupport(true);

  const handleLike = async () => {
    await recordHeart();
    setHasHearted(true);
    try { await AsyncStorage.setItem(HEART_KEY, '1'); } catch (e) {}
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

      <View style={styles.section}>
        <Text style={styles.label}>Appearance</Text>
        <Text style={styles.help}>Switch between dark and light theme.</Text>
        <TouchableOpacity style={styles.themeBtn} onPress={toggle}>
          <Ionicons name={mode === 'dark' ? 'moon' : 'sunny'} size={16} color={theme.textPrimary} />
          <Text style={styles.themeBtnText}>{mode === 'dark' ? 'Dark' : 'Light'} mode</Text>
          <Ionicons name="swap-horizontal" size={14} color={theme.textMuted} />
        </TouchableOpacity>
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

      <Text style={styles.footer}>Made by PullFool · v1.0.0</Text>

      <SupportModal
        open={showSupport}
        alreadyHearted={hasHearted}
        onClose={() => setShowSupport(false)}
        onLike={handleLike}
      />
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
});
