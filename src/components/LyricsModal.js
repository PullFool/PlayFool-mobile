import React, { useState, useEffect } from 'react';
import { View, Text, Modal, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { reportError } from '../utils/errorReporter';

const CACHE_PREFIX = 'playfool_mobile_lyrics:';

// Parse "Artist - Title (anything)" patterns common in YouTube downloads.
function splitArtistTitle(title) {
  if (!title) return null;
  const cleaned = title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\s+(official\s+(music\s+)?video|lyric(s)?\s+video|hd|hq)\s*$/i, '')
    .trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return null;
}

async function fetchLyrics(artist, title) {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lyrics API ${res.status}`);
  const data = await res.json();
  if (!data.lyrics) throw new Error('No lyrics found');
  return data.lyrics.trim();
}

export default function LyricsModal({ open, song, onClose }) {
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !song) return;
    setLyrics('');
    setError('');

    const split = splitArtistTitle(song.title);
    if (!split) {
      setError("Couldn't detect artist and title. Lyrics search needs an 'Artist - Title' format.");
      return;
    }

    const cacheKey = CACHE_PREFIX + `${split.artist}|${split.title}`.toLowerCase();
    setLoading(true);

    (async () => {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          setLyrics(cached);
          setLoading(false);
          return;
        }
        const text = await fetchLyrics(split.artist, split.title);
        setLyrics(text);
        try { await AsyncStorage.setItem(cacheKey, text); } catch (e) {}
      } catch (e) {
        reportError('lyrics', e, { song: song.title });
        setError(e.message || 'Could not load lyrics');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, song]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{song?.title || 'Lyrics'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.green} />
              <Text style={styles.statusText}>Searching lyrics...</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={48} color={theme.textMuted} />
              <Text style={styles.statusText}>{error}</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll}>
              <Text style={styles.lyrics}>{lyrics}</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modal: { backgroundColor: theme.bgSecondary, borderTopLeftRadius: 16, borderTopRightRadius: 16, height: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.textPrimary, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 12 },
  close: { padding: 4 },
  scroll: { padding: 20 },
  lyrics: { color: theme.textPrimary, fontSize: 15, lineHeight: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  statusText: { color: theme.textMuted, marginTop: 12, textAlign: 'center', fontSize: 13 },
});
