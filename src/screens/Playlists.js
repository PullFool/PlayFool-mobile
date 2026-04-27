import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';

export default function Playlists() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Playlists</Text>
      <View style={styles.empty}>
        <Ionicons name="list" size={48} color={theme.textMuted} />
        <Text style={styles.emptyText}>Playlists coming in the next update.</Text>
        <Text style={styles.emptyHint}>For now, use Shuffle on My Music to play your library randomly.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bgPrimary, padding: 16 },
  heading: { color: theme.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: theme.textPrimary, fontSize: 15, marginTop: 16 },
  emptyHint: { color: theme.textMuted, fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
});
