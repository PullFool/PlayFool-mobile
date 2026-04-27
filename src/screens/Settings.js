import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';

const KOFI_URL = 'https://ko-fi.com/PullFool';

export default function Settings() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.label}>About PlayFool</Text>
        <Text style={styles.help}>
          Free, ad-free music player with built-in YouTube search and download.{'\n\n'}
          All downloaded MP3s are saved to your phone's PlayFool folder and play offline.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Support PlayFool</Text>
        <Text style={styles.help}>
          PlayFool is built with love and is completely free. If you enjoy it, a small tip helps keep it going.
        </Text>
        <TouchableOpacity style={styles.heartBtn} onPress={() => Linking.openURL(KOFI_URL)}>
          <Ionicons name="heart" size={18} color="#fff" />
          <Text style={styles.heartBtnText}>Support on Ko-fi</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Made by PullFool · v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bgPrimary, padding: 16 },
  heading: { color: theme.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  section: { backgroundColor: theme.bgCard, borderRadius: 8, padding: 16, marginBottom: 16 },
  label: { color: theme.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  help: { color: theme.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  heartBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.red, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, alignSelf: 'flex-start' },
  heartBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  footer: { color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 24, marginBottom: 40 },
});
