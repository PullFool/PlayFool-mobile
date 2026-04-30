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

// Sentinel thrown when the lyrics provider responds with 404 — we treat this
// as an expected 'not found' state instead of a reportable error.
class LyricsNotFound extends Error {
  constructor(msg) { super(msg); this.code = 'NOT_FOUND'; }
}

async function fetchLyrics(artist, title) {
  // Try lrclib.net first (same source the desktop app uses) — bigger catalog
  // and synced lyrics. Fall back to api.lyrics.ovh if lrclib has nothing.
  try {
    const lr = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (lr.ok) {
      const d = await lr.json();
      const text = d?.syncedLyrics || d?.plainLyrics;
      if (text && text.trim()) return text.trim();
    }
  } catch (e) { /* try fallback */ }

  const res = await fetch(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
  );
  if (res.status === 404) throw new LyricsNotFound('No lyrics found for this song');
  if (!res.ok) throw new Error(`Lyrics API ${res.status}`);
  const data = await res.json();
  if (!data.lyrics) throw new LyricsNotFound('No lyrics found for this song');
  return data.lyrics.trim();
}

export default function LyricsModal({ open, song, onClose }) {
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(false);
  // status: '' | 'notfound' | 'unparseable' | 'error'
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open || !song) return;
    setLyrics('');
    setStatus('');

    const split = splitArtistTitle(song.title);
    if (!split) {
      setStatus('unparseable');
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
        if (e.code === 'NOT_FOUND') {
          setStatus('notfound');
        } else {
          reportError('lyrics', e, { song: song.title });
          setStatus('error');
        }
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
          ) : status === 'notfound' ? (
            <View style={styles.center}>
              <Ionicons name="musical-notes-outline" size={56} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>No lyrics found</Text>
              <Text style={styles.emptyHint}>
                We couldn't find lyrics for this track. It might be too new, an instrumental, or just not in our database yet.
              </Text>
            </View>
          ) : status === 'unparseable' ? (
            <View style={styles.center}>
              <Ionicons name="search-outline" size={56} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>Can't search lyrics</Text>
              <Text style={styles.emptyHint}>
                The file name doesn't include an artist. Lyrics search works best with songs named like 'Artist - Title'.
              </Text>
            </View>
          ) : status === 'error' ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={56} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>Couldn't load lyrics</Text>
              <Text style={styles.emptyHint}>
                Check your internet connection and try again.
              </Text>
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
  emptyTitle: { color: theme.textPrimary, marginTop: 16, fontSize: 16, fontWeight: '700' },
  emptyHint: { color: theme.textMuted, marginTop: 8, textAlign: 'center', fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
});
