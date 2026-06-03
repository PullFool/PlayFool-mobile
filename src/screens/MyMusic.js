import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl, Alert, ActivityIndicator, ToastAndroid } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { listLocalAudio, deleteLocalAudio, scanPhoneAudio, localSongKey } from '../utils/yt';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';
import AddToPlaylistModal from '../components/AddToPlaylistModal';

const SCAN_CACHE_KEY = 'playfool_mobile_scan_cache';
const LIB_CACHE_KEY = 'playfool_mobile_lib_cache';

export default function MyMusic() {
  const { playSong, shufflePlay, currentSong, isPlaying, playNext, addToQueue } = usePlayer();
  const [downloaded, setDownloaded] = useState([]);
  const [scanned, setScanned] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState('');
  const [addToPlaylistSong, setAddToPlaylistSong] = useState(null);

  // Two-phase load: paint the cached library instantly so the screen
  // doesn't feel like it's "scanning" every time the app opens, then
  // refresh listLocalAudio in the background and update + re-cache.
  const load = useCallback(async () => {
    let hasCached = false;
    try {
      const cachedLib = await AsyncStorage.getItem(LIB_CACHE_KEY);
      if (cachedLib) {
        try {
          const list = JSON.parse(cachedLib);
          if (Array.isArray(list) && list.length) { setDownloaded(list); hasCached = true; }
        } catch (e) {}
      }
      const cachedScan = await AsyncStorage.getItem(SCAN_CACHE_KEY);
      if (cachedScan) {
        try { setScanned(JSON.parse(cachedScan)); } catch (e) {}
      }
    } catch (e) {}

    // Spinner only on the very first launch (no cache) — otherwise the
    // refresh runs silently behind the already-painted list.
    if (!hasCached) setLoading(true);
    try {
      const list = await listLocalAudio();
      setDownloaded(list);
      AsyncStorage.setItem(LIB_CACHE_KEY, JSON.stringify(list)).catch(() => {});
    } catch (e) {
      reportError('mymusic.load', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const list = await scanPhoneAudio();
      setScanned(list);
      await AsyncStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(list));
    } catch (e) {
      if (e.code === 'PERMISSION_DENIED') {
        Alert.alert('Permission needed', 'PlayFool needs access to your audio files to scan them. Open Settings → PlayFool → Permissions to allow.');
      } else {
        reportError('mymusic.scan', e);
        Alert.alert('Scan failed', e.message || 'Could not scan phone audio');
      }
    } finally {
      setScanning(false);
    }
  }, []);

  // Reload every time the tab is focused so new YouTube downloads appear immediately
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Merge downloaded + scanned (downloaded first), de-dupe by normalized
  // song name. PlayFool's own downloads show up in BOTH lists — once from
  // the SAF folder and again from the phone-wide scan — with different URIs
  // each time, so a url-based de-dupe let the same song through twice.
  const seen = new Set();
  const songs = [];
  for (const s of [...downloaded, ...scanned]) {
    const key = localSongKey(s.title || '') || s.url;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(s);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? songs.filter(s => (s.title || '').toLowerCase().includes(q))
    : songs;

  // Scanned songs come from the phone's MediaStore — we can't delete them
  // (no permission, system-owned). Just drop them from our scan cache so they
  // don't show in PlayFool. They stay on the phone and reappear if the user
  // taps Scan Phone again. Downloaded songs (in our app folder) are actually
  // deleted from disk.
  const showAddOptions = (song) => {
    Alert.alert(
      song.title,
      'What do you want to do with this song?',
      [
        {
          text: 'Play next',
          onPress: () => {
            playNext(song);
            ToastAndroid.show('Playing next', ToastAndroid.SHORT);
          },
        },
        {
          text: 'Add to queue',
          onPress: () => {
            addToQueue(song);
            ToastAndroid.show('Added to queue', ToastAndroid.SHORT);
          },
        },
        {
          text: 'Add to playlist',
          onPress: () => setAddToPlaylistSong(song),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const confirmDelete = (song) => {
    const isScanned = song.source === 'scanned';
    // SAF-stored files (source 'saf') delete silently without an Android
    // prompt, so a single PlayFool confirm is the whole flow. Legacy
    // MediaStore files (source 'local') will still get one Android prompt
    // after our confirm — that's a one-time pain to clean up old downloads.
    const title = isScanned ? 'Remove from PlayFool?' : 'Delete this song?';
    const body = isScanned
      ? `"${song.title}"\n\nThis only hides the song in PlayFool. The file stays on your phone and will come back the next time you tap Scan Phone.`
      : `"${song.title}"\n\nThe file will be permanently removed from your phone.`;
    Alert.alert(
      title,
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isScanned ? 'Remove' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (isScanned) {
              const next = scanned.filter((s) => s.url !== song.url);
              setScanned(next);
              try { await AsyncStorage.setItem(SCAN_CACHE_KEY, JSON.stringify(next)); } catch (e) {}
              return;
            }
            try { await deleteLocalAudio(song); load(); }
            catch (e) { reportError('mymusic.delete', e, { id: song.id, source: song.source }); }
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

      <View style={styles.scanRow}>
        <TouchableOpacity style={styles.scanBtn} onPress={handleScan} disabled={scanning}>
          {scanning
            ? <ActivityIndicator size="small" color={theme.textPrimary} />
            : <Ionicons name="phone-portrait-outline" size={14} color={theme.textPrimary} />
          }
          <Text style={styles.scanBtnText}>{scanning ? 'Scanning...' : 'Scan Phone'}</Text>
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
              <TouchableOpacity onPress={() => showAddOptions(item)} style={styles.trashBtn}>
                <Ionicons name="add-circle-outline" size={18} color={theme.textMuted} />
              </TouchableOpacity>
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

      <AddToPlaylistModal
        open={!!addToPlaylistSong}
        song={addToPlaylistSong}
        onClose={() => setAddToPlaylistSong(null)}
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
  scanRow: { marginBottom: 8 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: theme.bgSurface, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  scanBtnText: { color: theme.textPrimary, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: theme.textPrimary, marginTop: 12, fontSize: 15 },
  emptyHint: { color: theme.textMuted, fontSize: 12, marginTop: 6, paddingHorizontal: 32, textAlign: 'center' },
});
