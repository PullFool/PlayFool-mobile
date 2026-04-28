import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, StyleSheet, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';
import { loadPlaylists, addSongToPlaylist, createPlaylist } from '../utils/playlists';
import { reportError } from '../utils/errorReporter';

export default function AddToPlaylistModal({ open, song, onClose }) {
  const [playlists, setPlaylists] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) return;
    loadPlaylists().then(setPlaylists).catch((e) => reportError('atp.load', e));
    setCreating(false);
    setName('');
  }, [open]);

  const addTo = async (id) => {
    try { await addSongToPlaylist(id, song); onClose(); }
    catch (e) { reportError('atp.add', e); Alert.alert('Add failed', e.message); }
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const pl = await createPlaylist(trimmed);
      await addSongToPlaylist(pl.id, song);
      onClose();
    } catch (e) { reportError('atp.create', e); Alert.alert('Create failed', e.message); }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>Add to playlist</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={20} color={theme.textSecondary} /></TouchableOpacity>
          </View>

          <Text style={styles.songTitle} numberOfLines={1}>{song?.title}</Text>

          {creating ? (
            <View style={styles.createBox}>
              <TextInput
                style={styles.input}
                placeholder="New playlist name"
                placeholderTextColor={theme.textMuted}
                value={name}
                onChangeText={setName}
                autoFocus
              />
              <View style={styles.createActions}>
                <TouchableOpacity style={styles.cancel} onPress={() => setCreating(false)}>
                  <Text style={styles.cancelText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primary} onPress={createAndAdd}>
                  <Text style={styles.primaryText}>Create & add</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity style={styles.newBtn} onPress={() => setCreating(true)}>
                <Ionicons name="add-circle" size={18} color={theme.green} />
                <Text style={styles.newBtnText}>New playlist</Text>
              </TouchableOpacity>

              <FlatList
                data={playlists}
                keyExtractor={(p) => p.id}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.row} onPress={() => addTo(item.id)}>
                    <View style={styles.rowIcon}><Ionicons name="list" size={16} color={theme.textMuted} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowMeta}>{item.songs.length} song{item.songs.length !== 1 ? 's' : ''}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.empty}>No playlists yet — create one above.</Text>}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: theme.bgSecondary, borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: theme.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: theme.textPrimary, fontSize: 16, fontWeight: '700' },
  songTitle: { color: theme.textSecondary, fontSize: 12, marginBottom: 14 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  newBtnText: { color: theme.green, fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowIcon: { width: 36, height: 36, borderRadius: 6, backgroundColor: theme.bgSurface, alignItems: 'center', justifyContent: 'center' },
  rowName: { color: theme.textPrimary, fontSize: 14, fontWeight: '500' },
  rowMeta: { color: theme.textSecondary, fontSize: 11 },
  empty: { color: theme.textMuted, textAlign: 'center', paddingVertical: 24, fontSize: 12 },
  createBox: { gap: 12 },
  input: { backgroundColor: theme.bgSurface, color: theme.textPrimary, borderRadius: 8, paddingHorizontal: 12, height: 44, fontSize: 14 },
  createActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  cancel: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { color: theme.textSecondary, fontWeight: '600' },
  primary: { backgroundColor: theme.green, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  primaryText: { color: '#000', fontWeight: '700' },
});
