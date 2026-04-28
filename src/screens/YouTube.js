import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';
import { searchMusic, getAudioStreamUrl, downloadAudio } from '../utils/yt';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';

export default function YouTube() {
  const { playSong } = usePlayer();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [downloadState, setDownloadState] = useState({}); // { [videoId]: 'downloading' | percent | 'done' }

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    setDownloadState({});
    try {
      const data = await searchMusic(query.trim(), 30);
      setResults(data);
    } catch (e) {
      reportError('search', e, { query: query.trim() });
      setError(e.message || 'Search failed.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const preview = async (video) => {
    try {
      const url = await getAudioStreamUrl(video.id);
      playSong([{
        id: `preview-${video.id}`,
        title: video.title,
        artist: video.channel,
        url,
        cover: video.thumbnail,
        source: 'preview',
      }], 0);
    } catch (e) {
      reportError('preview', e, { videoId: video.id });
      setError('Preview failed: ' + e.message);
    }
  };

  const startDownload = async (video) => {
    if (downloadState[video.id]) return;
    setDownloadState(s => ({ ...s, [video.id]: 0 }));
    try {
      await downloadAudio(video, (percent) => {
        setDownloadState(s => ({ ...s, [video.id]: percent }));
      });
      setDownloadState(s => ({ ...s, [video.id]: 'done' }));
    } catch (e) {
      reportError('download', e, { videoId: video.id, title: video.title });
      setError('Download failed: ' + e.message);
      setDownloadState(s => { const n = { ...s }; delete n[video.id]; return n; });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>YouTube</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search music..."
          placeholderTextColor={theme.textMuted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={search} disabled={searching}>
          {searching
            ? <ActivityIndicator size="small" color="#000" />
            : <Ionicons name="search" size={18} color="#000" />
          }
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const state = downloadState[item.id];
          const downloading = typeof state === 'number';
          const done = state === 'done';
          return (
            <View style={styles.row}>
              <TouchableOpacity onPress={() => preview(item)} style={styles.thumbWrap}>
                {item.thumbnail
                  ? <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
                  : <Ionicons name="musical-notes" size={20} color={theme.textMuted} />
                }
                <View style={styles.playOverlay}>
                  <Ionicons name="play" size={18} color="#fff" />
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => preview(item)} style={styles.info}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.meta}>{item.channel} · {item.duration}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => startDownload(item)}
                disabled={downloading || done}
                style={[styles.dlBtn, done && styles.dlBtnDone]}
              >
                <Text style={styles.dlBtnText}>
                  {downloading ? `${state}%` : done ? '✓' : 'MP3'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          !searching && (
            <View style={styles.empty}>
              <Ionicons name="search" size={48} color={theme.textMuted} />
              <Text style={styles.emptyText}>Search YouTube for music</Text>
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
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  search: { flex: 1, backgroundColor: theme.bgSurface, color: theme.textPrimary, borderRadius: 8, paddingHorizontal: 12, height: 40, fontSize: 14 },
  searchBtn: { backgroundColor: theme.green, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#ff6b6b', fontSize: 13, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, alignItems: 'center' },
  thumbWrap: { width: 60, height: 60, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.bgSurface, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { color: theme.textPrimary, fontSize: 13, fontWeight: '500' },
  meta: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  dlBtn: { backgroundColor: theme.green, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, minWidth: 60, alignItems: 'center' },
  dlBtnDone: { backgroundColor: theme.green },
  dlBtnText: { color: '#000', fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: theme.textMuted, marginTop: 12 },
});
