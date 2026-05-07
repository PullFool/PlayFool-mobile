import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { searchMusic, getAudioStreamUrl, downloadAudio } from '../utils/yt';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';

const HISTORY_KEY = 'playfool_mobile_search_history';

export default function YouTube() {
  const { playSong } = usePlayer();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [downloadState, setDownloadState] = useState({}); // { [videoId]: 'downloading' | percent | 'done' }
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load search history on mount
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((raw) => {
      if (raw) try { setHistory(JSON.parse(raw)); } catch (e) {}
    });
  }, []);

  const saveHistory = async (term) => {
    const next = [term, ...history.filter((h) => h !== term)].slice(0, 10);
    setHistory(next);
    try { await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch (e) {}
  };

  const removeHistoryItem = async (term) => {
    const next = history.filter((h) => h !== term);
    setHistory(next);
    try { await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch (e) {}
  };

  const runSearch = async (text) => {
    const term = (text || query).trim();
    if (!term) return;
    setQuery(term);
    setShowHistory(false);
    setSearching(true);
    setError('');
    setDownloadState({});
    saveHistory(term);
    try {
      const data = await searchMusic(term, 30);
      setResults(data);
    } catch (e) {
      reportError('search', e, { query: term });
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
      // Keep the FULL message — no .split('\n')[0]. The user needs to be
      // able to share/copy the whole chain so we can diagnose.
      setError('Download failed: ' + (e.message || String(e)));
      setDownloadState(s => ({ ...s, [video.id]: 'error' }));
    }
  };

  const shareError = async () => {
    if (!error) return;
    try {
      await Share.share({ message: error });
    } catch (e) {
      // user dismissed or sharing not available — nothing to do
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>YouTube</Text>

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <TextInput
            style={styles.search}
            placeholder="Search music..."
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch()}
            onFocus={() => { if (!query && history.length > 0) setShowHistory(true); }}
            onBlur={() => setTimeout(() => setShowHistory(false), 150)}
            returnKeyType="search"
          />
          {showHistory && history.length > 0 && (
            <View style={styles.historyDropdown}>
              {history.map((h) => (
                <View key={h} style={styles.historyItem}>
                  <TouchableOpacity style={styles.historyText} onPress={() => runSearch(h)}>
                    <Ionicons name="time-outline" size={14} color={theme.textMuted} />
                    <Text style={styles.historyLabel} numberOfLines={1}>{h}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeHistoryItem(h)} style={styles.historyRemove}>
                    <Ionicons name="close" size={14} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.searchBtn} onPress={() => runSearch()} disabled={searching}>
          {searching
            ? <ActivityIndicator size="small" color="#000" />
            : <Ionicons name="search" size={18} color="#000" />
          }
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error} selectable>{error}</Text>
          <TouchableOpacity style={styles.errorShareBtn} onPress={shareError}>
            <Ionicons name="share-outline" size={14} color="#fff" />
            <Text style={styles.errorShareLabel}>Share error</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const state = downloadState[item.id];
          const downloading = typeof state === 'number';
          const done = state === 'done';
          const failed = state === 'error';
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
                onPress={() => {
                  if (failed) {
                    // Reset state and retry the download
                    setDownloadState(s => { const n = { ...s }; delete n[item.id]; return n; });
                    startDownload(item);
                  } else {
                    startDownload(item);
                  }
                }}
                disabled={downloading || done}
                style={[
                  styles.dlBtn,
                  done && styles.dlBtnDone,
                  downloading && styles.dlBtnBusy,
                  failed && styles.dlBtnFailed,
                ]}
              >
                {downloading ? (
                  <Text style={styles.dlBtnText}>{state}%</Text>
                ) : done ? (
                  <View style={styles.dlBtnDoneInner}>
                    <Ionicons name="checkmark-circle" size={14} color="#000" />
                    <Text style={styles.dlBtnText}>Done</Text>
                  </View>
                ) : failed ? (
                  <View style={styles.dlBtnDoneInner}>
                    <Ionicons name="refresh" size={14} color="#fff" />
                    <Text style={[styles.dlBtnText, { color: '#fff' }]}>Retry</Text>
                  </View>
                ) : (
                  <Text style={styles.dlBtnText}>MP3</Text>
                )}
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
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12, position: 'relative' },
  searchInputWrap: { flex: 1, position: 'relative' },
  search: { backgroundColor: theme.bgSurface, color: theme.textPrimary, borderRadius: 8, paddingHorizontal: 12, height: 40, fontSize: 14 },
  searchBtn: { backgroundColor: theme.green, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  historyDropdown: {
    position: 'absolute', top: 44, left: 0, right: 0,
    backgroundColor: theme.bgSurface, borderRadius: 8,
    borderWidth: 1, borderColor: theme.border,
    zIndex: 100, elevation: 8,
    maxHeight: 240,
  },
  historyItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: theme.bgPrimary },
  historyText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyLabel: { color: theme.textSecondary, fontSize: 13, flex: 1 },
  historyRemove: { padding: 4 },
  errorBox: {
    backgroundColor: 'rgba(255,107,107,0.10)',
    borderColor: 'rgba(255,107,107,0.4)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  error: { color: '#ff6b6b', fontSize: 12, lineHeight: 16 },
  errorShareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    marginTop: 8,
  },
  errorShareLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, alignItems: 'center' },
  thumbWrap: { width: 60, height: 60, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.bgSurface, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  playOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { color: theme.textPrimary, fontSize: 13, fontWeight: '500' },
  meta: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
  dlBtn: { backgroundColor: theme.green, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, minWidth: 70, alignItems: 'center' },
  dlBtnBusy: { opacity: 0.85 },
  dlBtnDone: { backgroundColor: theme.green, opacity: 1 },
  dlBtnFailed: { backgroundColor: '#ff6b6b' },
  dlBtnDoneInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dlBtnText: { color: '#000', fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: theme.textMuted, marginTop: 12 },
});
