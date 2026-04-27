import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../utils/theme';
import { listLocalAudio, deleteLocalAudio } from '../utils/yt';
import { usePlayer } from '../context/PlayerContext';

export default function MyMusic() {
  const { playSong, shufflePlay, currentSong, isPlaying } = usePlayer();
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listLocalAudio();
      setSongs(list);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload every time the tab is focused so new YouTube downloads appear immediately
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? songs.filter(s => (s.title || '').toLowerCase().includes(q))
    : songs;

  const confirmDelete = (song) => {
    Alert.alert(
      'Delete song?',
      `"${song.title}"\n\nThis will permanently delete the file from your phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try { await deleteLocalAudio(song.url); load(); } catch (e) {}
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Music</Text>

      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={theme.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.search}
            placeholder="Search your library..."
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={setQuery}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.clear}>
              <Ionicons name="close" size={16} color={theme.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.shuffleBtn} onPress={() => shufflePlay(filtered)} disabled={!filtered.length}>
          <Ionicons name="shuffle" size={16} color={theme.textPrimary} />
          <Text style={styles.shuffleText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.count}>
        {q ? `${filtered.length} of ${songs.length} songs` : `${songs.length} song${songs.length !== 1 ? 's' : ''}`}
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.green} />}
        renderItem={({ item, index }) => {
          const active = currentSong?.url === item.url;
          return (
            <TouchableOpacity
              onPress={() => playSong(filtered, index)}
              onLongPress={() => confirmDelete(item)}
              style={[styles.item, active && styles.itemActive]}
            >
              <Text style={styles.itemNumber}>{active && isPlaying ? '▶' : index + 1}</Text>
              <View style={styles.itemInfo}>
                <Text style={[styles.itemTitle, active && styles.itemTitleActive]} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.itemArtist} numberOfLines={1}>{item.artist || 'PlayFool'}</Text>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.trashBtn}>
                <Ionicons name="trash-outline" size={18} color={theme.red} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !loading && (
            <View style={styles.empty}>
              <Ionicons name="musical-notes" size={48} color={theme.textMuted} />
              <Text style={styles.emptyText}>No music yet</Text>
              <Text style={styles.emptyHint}>Search YouTube and download MP3s — they'll appear here.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bgPrimary, padding: 16 },
  heading: { color: theme.textPrimary, fontSize: 24, fontWeight: '700', marginBottom: 16 },
  toolbar: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  searchWrap: { flex: 1, position: 'relative' },
  searchIcon: { position: 'absolute', left: 12, top: 12, zIndex: 1 },
  search: { backgroundColor: theme.bgSurface, color: theme.textPrimary, borderRadius: 8, paddingLeft: 36, paddingRight: 32, height: 40, fontSize: 14 },
  clear: { position: 'absolute', right: 8, top: 8, padding: 4 },
  shuffleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.bgSurface, paddingHorizontal: 14, height: 40, borderRadius: 20 },
  shuffleText: { color: theme.textPrimary, fontSize: 13, fontWeight: '600' },
  count: { color: theme.textSecondary, fontSize: 12, marginBottom: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 6 },
  itemActive: { backgroundColor: theme.bgSurface },
  itemNumber: { color: theme.textSecondary, width: 24, textAlign: 'center', fontSize: 13 },
  itemInfo: { flex: 1, minWidth: 0 },
  itemTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '500' },
  itemTitleActive: { color: theme.green },
  itemArtist: { color: theme.textSecondary, fontSize: 12 },
  trashBtn: { padding: 6 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: theme.textPrimary, marginTop: 12, fontSize: 15 },
  emptyHint: { color: theme.textMuted, fontSize: 12, marginTop: 6, paddingHorizontal: 32, textAlign: 'center' },
});
