import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { reportError } from '../utils/errorReporter';

const REJECT_KEY = 'playfool_mobile_lyrics_rejected'; // { "title|artist": ["id"...] }
const LRCLIB_BASE = 'https://lrclib.net/api';

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

function songKey(artist, title) {
  return `${(artist || '').toLowerCase().trim()}|${(title || '').toLowerCase().trim()}`;
}

async function loadRejected(key) {
  try {
    const raw = await AsyncStorage.getItem(REJECT_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return Array.isArray(all[key]) ? all[key] : [];
  } catch (e) { return []; }
}

async function saveRejected(key, ids) {
  try {
    const raw = await AsyncStorage.getItem(REJECT_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[key] = ids;
    await AsyncStorage.setItem(REJECT_KEY, JSON.stringify(all));
  } catch (e) {}
}

// Fetch all lrclib search results so we can step through matches the user
// hasn't rejected. Returns the picked match + count metadata.
async function fetchLyricsWithMatch(artist, title, rejectedIds) {
  const q = `${title} ${artist}`.trim();
  const res = await fetch(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`lrclib ${res.status}`);
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const rejectedSet = new Set((rejectedIds || []).map(String));
  const eligible = results
    .map((r, i) => ({ ...r, _index: i }))
    .filter((r) => !rejectedSet.has(String(r.id)));
  if (!eligible.length) return null;

  // Prefer synced over plain.
  const pick = eligible.find((r) => r.syncedLyrics) || eligible[0];
  const text = pick.syncedLyrics || pick.plainLyrics || '';
  if (!text.trim()) return null;
  return {
    text: text.trim(),
    synced: !!pick.syncedLyrics,
    sourceId: String(pick.id),
    totalMatches: results.length,
    currentIndex: pick._index + 1,
  };
}

export default function LyricsModal({ open, song, onClose }) {
  const [lyrics, setLyrics] = useState('');
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(false);
  // status: '' | 'notfound' | 'unparseable' | 'error'
  const [status, setStatus] = useState('');
  const [keyParts, setKeyParts] = useState(null);

  const load = useCallback(async (parts) => {
    setLyrics(''); setStatus(''); setMatch(null);
    setLoading(true);
    try {
      const key = songKey(parts.artist, parts.title);
      const rejected = await loadRejected(key);
      const result = await fetchLyricsWithMatch(parts.artist, parts.title, rejected);
      if (!result) {
        setStatus(rejected.length ? 'noMore' : 'notfound');
        return;
      }
      setLyrics(result.text);
      setMatch({ sourceId: result.sourceId, total: result.totalMatches, current: result.currentIndex });
    } catch (e) {
      reportError('lyrics', e, { song: parts.title });
      setStatus('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !song) return;
    const parts = splitArtistTitle(song.title);
    if (!parts) { setStatus('unparseable'); setKeyParts(null); return; }
    setKeyParts(parts);
    load(parts);
  }, [open, song, load]);

  const skipMatch = async () => {
    if (!keyParts || !match?.sourceId) return;
    const key = songKey(keyParts.artist, keyParts.title);
    const next = Array.from(new Set([...(await loadRejected(key)), match.sourceId]));
    await saveRejected(key, next);
    load(keyParts);
  };

  const markWrong = () => {
    if (!keyParts || !match?.sourceId) return;
    Alert.alert(
      'Mark lyrics as wrong?',
      `We won't show this match for "${song?.title || 'this song'}" again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, skip these', style: 'destructive', onPress: skipMatch },
      ],
    );
  };

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
          ) : status === 'notfound' || status === 'noMore' ? (
            <View style={styles.center}>
              <Ionicons name="musical-notes-outline" size={56} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>
                {status === 'noMore' ? 'No more matches to try' : 'No lyrics found'}
              </Text>
              <Text style={styles.emptyHint}>
                {status === 'noMore'
                  ? "You've rejected every match for this song. Reset rejections in Settings if you want to try again."
                  : "We couldn't find lyrics for this track. It might be too new, an instrumental, or just not in our database yet."}
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

          {match && match.total > 0 && !loading && (
            <View style={styles.matchBar}>
              <Text style={styles.matchSource}>
                lrclib · match {match.current} of {match.total}
              </Text>
              <View style={styles.matchActions}>
                <TouchableOpacity
                  onPress={skipMatch}
                  disabled={match.total <= match.current}
                  style={[styles.matchBtn, match.total <= match.current && styles.matchBtnDisabled]}
                >
                  <Ionicons name="play-skip-forward" size={12} color={theme.textSecondary} />
                  <Text style={styles.matchBtnText}>Try next</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={markWrong} style={styles.matchBtn}>
                  <Ionicons name="thumbs-down" size={12} color={theme.textSecondary} />
                  <Text style={styles.matchBtnText}>Wrong</Text>
                </TouchableOpacity>
              </View>
            </View>
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
  matchBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: theme.border,
    backgroundColor: theme.bgPrimary,
  },
  matchSource: { color: theme.textMuted, fontSize: 11 },
  matchActions: { flexDirection: 'row', gap: 6 },
  matchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 4, paddingHorizontal: 10,
    borderRadius: 12, borderWidth: 1, borderColor: theme.border,
  },
  matchBtnDisabled: { opacity: 0.4 },
  matchBtnText: { color: theme.textSecondary, fontSize: 11, fontWeight: '600' },
});
