import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { checkForUpdate, downloadApk, installApk } from '../utils/updater';
import { reportError } from '../utils/errorReporter';

const LAST_CHECK_KEY = 'playfool_mobile_update_check';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

export default function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [stage, setStage] = useState('idle'); // idle | downloading | ready | error
  const [percent, setPercent] = useState(0);
  const [apkUri, setApkUri] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = await AsyncStorage.getItem(LAST_CHECK_KEY);
        const now = Date.now();
        if (last && now - Number(last) < CHECK_INTERVAL_MS) return;

        const found = await checkForUpdate();
        if (cancelled) return;
        try { await AsyncStorage.setItem(LAST_CHECK_KEY, String(now)); } catch (e) {}
        if (found) {
          setInfo(found);
          // Auto-download in background so the user only has to tap Install once
          setStage('downloading');
          try {
            const uri = await downloadApk(found.downloadUrl, found.fileName, (p) => {
              if (!cancelled) setPercent(p);
            });
            if (cancelled) return;
            setApkUri(uri);
            setStage('ready');
          } catch (e) {
            if (cancelled) return;
            reportError('updater.download', e);
            setStage('error');
          }
        }
      } catch (e) { reportError('updater.check', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  const onInstall = async () => {
    if (!apkUri) return;
    try {
      await installApk(apkUri);
    } catch (e) {
      reportError('updater.install', e);
      setStage('error');
    }
  };

  if (!info || dismissed) return null;

  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        <Ionicons name="cloud-download" size={18} color={theme.green} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>v{info.version} available</Text>
          <Text style={styles.subtitle}>
            {stage === 'downloading' && `Preparing… ${percent}%`}
            {stage === 'ready' && 'Tap Install to update'}
            {stage === 'error' && 'Download failed — try again later'}
            {stage === 'idle' && 'Download starting…'}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {stage === 'ready' && (
          <TouchableOpacity style={styles.installBtn} onPress={onInstall}>
            <Text style={styles.installText}>Install</Text>
          </TouchableOpacity>
        )}
        {stage === 'downloading' && <ActivityIndicator size="small" color={theme.green} />}
        <TouchableOpacity onPress={() => setDismissed(true)} style={styles.close}>
          <Ionicons name="close" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bgSecondary,
    borderBottomWidth: 1, borderBottomColor: theme.green,
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: theme.textPrimary, fontSize: 13, fontWeight: '700' },
  subtitle: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  installBtn: { backgroundColor: theme.green, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14 },
  installText: { color: '#000', fontSize: 12, fontWeight: '700' },
  close: { padding: 4 },
});
