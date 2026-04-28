import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  Alert, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../utils/theme';
import {
  loadPlaylists, createPlaylist, deletePlaylist, removeSongFromPlaylist,
} from '../utils/playlists';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';

export default function Playlists() {
  const { playSong, shufflePlay, currentSong, isPlaying } = usePlayer();
  const [playlists, setPlaylists] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    try { setPlaylists(await loadPlaylists()); }
    catch (e) { reportError('playlists.load', e); }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createPlaylist(name);
      setNewName('');
      setShowCreate(false);
      refresh();
    } catch (e) { reportError('playlists.create', e); }
  };

  const onDelete = (playlist) => {
    Alert.alert('Delete playlist?', `"${playlist.name}" will be removed. The songs themselves stay on your phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deletePlaylist(playlist.id); refresh(); }
        catch (e) { reportError('playlists.delete', e); }
      } },
    ]);
  };

  const onRemoveSong = async (playlistId, song) => {
    try { await removeSongFromPlaylist(playlistId, song.url); refresh(); }
    catch (e) { reportError('playlists.removeSong', e); }
  };

  const open = playlists.find((p) => p.id === openId);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>{open ? open.name : 'Playlists'}</Text>
        {!open && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)}>
            <Ionicons name="add" size={20} color="#000" />
          </TouchableOpacity>
        )}
        {open && (
          <TouchableOpacity onPress={() => setOpenId(null)}>
            <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {!open ? (
        <FlatList
          data={playlists}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.playlistRow} onPress={() => setOpenId(item.id)}>
              <View style={styles.coverFallback}><Ionicons name="list" size={20} color={theme.textMuted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.playlistName}>{item.name}</Text>
                <Text style={styles.playlistMeta}>{item.songs.length} song{item.songs.length !== 1 ? 's' : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => onDelete(item)} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={theme.red} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="list" size={48} color={theme.textMuted} />
              <Text style={styles.emptyText}>No playlists yet</Text>
              <Text style={styles.emptyHint}>Tap + to create your first playlist.</Text>
            </View>
          }
        />
      ) : (
        <>
          <View style={styles.toolbar}>
            <TouchableOpacity
              style={styles.shuffleBtn}
              disabled={!open.songs.length}
              onPress={() => shufflePlay(open.songs)}
            >
              <Ionicons name="shuffle" size={16} color={theme.textPrimary} />
              <Text style={styles.shuffleText}>Shuffle</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.playAllBtn}
              disabled={!open.songs.length}
              onPress={() => playSong(open.songs, 0)}
            >
              <Ionicons name="play" size={16} color="#000" />
              <Text style={styles.playAllText}>Play All</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={open.songs}
            keyExtractor={(s) => s.url}
            renderItem={({ item, index }) => {
              const active = currentSong?.url === item.url;
              return (
                <TouchableOpacity style={[styles.songRow, active && styles.songActive]} onPress={() => playSong(open.songs, index)}>
                  <Text style={styles.songNumber}>{active && isPlaying ? '▶' : index + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.songTitle, active && styles.songTitleActive]} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.songArtist}>{item.artist || 'PlayFool'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => onRemoveSong(open.id, item)} style={styles.iconBtn}>
                    <Ionicons name="remove-circle-outline" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>This playlist is empty</Text>
                <Text style={styles.emptyHint}>Open a song from My Music and add it to this playlist.</Text>
              </View>
            }
          />
        </>
      )}

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New playlist</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Playlist name"
              placeholderTextColor={theme.textMuted}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowCreate(false); setNewName(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCreate} onPress={onCreate}>
                <Text style={styles.modalCreateText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bgPrimary, padding: 16 },
  heading: { color: theme.textPrimary, fontSize: 24, fontWeight: '700', flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  addBtn: { backgroundColor: theme.green, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  playlistRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  coverFallback: { width: 44, height: 44, borderRadius: 6, backgroundColor: theme.bgSurface, alignItems: 'center', justifyContent: 'center' },
  playlistName: { color: theme.textPrimary, fontSize: 15, fontWeight: '600' },
  playlistMeta: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 8 },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  shuffleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.bgSurface, paddingHorizontal: 14, height: 38, borderRadius: 19 },
  shuffleText: { color: theme.textPrimary, fontSize: 13, fontWeight: '600' },
  playAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.green, paddingHorizontal: 16, height: 38, borderRadius: 19 },
  playAllText: { color: '#000', fontSize: 13, fontWeight: '700' },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 6 },
  songActive: { backgroundColor: theme.bgSurface },
  songNumber: { color: theme.textSecondary, width: 24, textAlign: 'center', fontSize: 13 },
  songTitle: { color: theme.textPrimary, fontSize: 14 },
  songTitleActive: { color: theme.green },
  songArtist: { color: theme.textSecondary, fontSize: 12 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: theme.textPrimary, fontSize: 15, marginTop: 12 },
  emptyHint: { color: theme.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: theme.bgSecondary, borderRadius: 12, padding: 20, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: theme.border },
  modalTitle: { color: theme.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  modalInput: { backgroundColor: theme.bgSurface, color: theme.textPrimary, borderRadius: 8, paddingHorizontal: 12, height: 44, fontSize: 14, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  modalCancelText: { color: theme.textSecondary, fontWeight: '600' },
  modalCreate: { backgroundColor: theme.green, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  modalCreateText: { color: '#000', fontWeight: '700' },
});
