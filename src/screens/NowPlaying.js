import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, Modal, StyleSheet,
  ScrollView, ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

const LYRICS_CACHE_PREFIX = 'playfool_mobile_lyrics:';

function splitArtistTitle(title) {
  if (!title) return null;
  const cleaned = title
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\s+(official\s+(music\s+)?video|lyric(s)?\s+video|hd|hq)\s*$/i, '')
    .trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return null;
}

async function loadLyricsText(song) {
  const split = splitArtistTitle(song.title);
  if (!split) return { status: 'unparseable' };
  const key = LYRICS_CACHE_PREFIX + `${split.artist}|${split.title}`.toLowerCase();
  const cached = await AsyncStorage.getItem(key).catch(() => null);
  if (cached) return { status: 'ok', text: cached };
  try {
    const lr = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(split.artist)}&track_name=${encodeURIComponent(split.title)}`
    );
    if (lr.ok) {
      const d = await lr.json();
      const text = d?.plainLyrics || d?.syncedLyrics?.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
      if (text) {
        try { await AsyncStorage.setItem(key, text); } catch (e) {}
        return { status: 'ok', text };
      }
    }
  } catch (e) {}
  return { status: 'notfound' };
}

export default function NowPlaying({ visible, onClose }) {
  const {
    currentSong, isPlaying, position, duration, queue, songs, currentIndex,
    shuffle, repeat,
    togglePlayPause, skipNext, skipPrev, seekTo,
    toggleShuffle, toggleRepeat,
    removeFromQueue, playFromQueue,
  } = usePlayer();

  const [tab, setTab] = useState('upnext');
  const [lyrics, setLyrics] = useState({ status: 'idle', text: '' });
  const lastSongIdRef = useRef(null);

  // Reset to upnext tab whenever the modal opens
  useEffect(() => { if (visible) setTab('upnext'); }, [visible]);

  // Load lyrics when the lyrics tab is opened or the song changes
  useEffect(() => {
    if (!visible || tab !== 'lyrics' || !currentSong) return;
    if (lastSongIdRef.current === currentSong.id && lyrics.status !== 'idle') return;
    lastSongIdRef.current = currentSong.id;
    setLyrics({ status: 'loading', text: '' });
    loadLyricsText(currentSong)
      .then((r) => setLyrics(r))
      .catch((e) => { reportError('nowplaying.lyrics', e); setLyrics({ status: 'notfound' }); });
  }, [visible, tab, currentSong]);

  const upcoming = (() => {
    const list = [];
    for (const q of queue) list.push({ ...q, _from: 'queue' });
    if (currentIndex >= 0) {
      for (let i = currentIndex + 1; i < songs.length && list.length < 30; i++) {
        list.push({ ...songs[i], _from: 'songs', _idx: i });
      }
    }
    return list;
  })();

  const progress = duration ? Math.min(1, position / duration) : 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="chevron-down" size={26} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topLabel}>Now Playing</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.coverWrap}>
            {currentSong?.cover ? (
              <Image source={{ uri: currentSong.cover }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverFallback]}>
                <Ionicons name="musical-notes" size={80} color={theme.green} />
              </View>
            )}
          </View>

          <View style={styles.meta}>
            <Text style={styles.songTitle} numberOfLines={2}>
              {currentSong?.title || 'No song playing'}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {currentSong?.artist || 'PlayFool'}
            </Text>
          </View>

          {/* Progress */}
          <View style={styles.progressRow}>
            <Text style={styles.time}>{fmt(position)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.time}>{fmt(duration)}</Text>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={toggleShuffle} hitSlop={8}>
              <Ionicons name="shuffle" size={22} color={shuffle ? theme.green : theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={skipPrev} hitSlop={8}>
              <Ionicons name="play-skip-back" size={28} color={theme.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => seekTo(Math.max(0, position - 10))} hitSlop={8}>
              <Ionicons name="play-back" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={styles.playBtn}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => seekTo(position + 10)} hitSlop={8}>
              <Ionicons name="play-forward" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={skipNext} hitSlop={8}>
              <Ionicons name="play-skip-forward" size={28} color={theme.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleRepeat} hitSlop={8}>
              <Ionicons
                name={repeat === 2 ? 'repeat' : 'repeat'}
                size={22}
                color={repeat > 0 ? theme.green : theme.textSecondary}
              />
              {repeat === 2 && <View style={styles.repeatOneDot} />}
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabRow}>
            {['upnext', 'lyrics'].map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'upnext' ? 'Up Next' : 'Lyrics'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'upnext' && (
            <View style={styles.tabContent}>
              {upcoming.length === 0 ? (
                <Text style={styles.empty}>Nothing up next.</Text>
              ) : (
                upcoming.map((s, i) => (
                  <View key={`${s.id}-${i}`} style={styles.queueRow}>
                    <Text style={styles.queueNum}>{i + 1}</Text>
                    <View style={styles.queueInfo}>
                      <Text style={styles.queueTitle} numberOfLines={1}>{s.title}</Text>
                      <Text style={styles.queueArtist} numberOfLines={1}>
                        {s.artist || (s._from === 'queue' ? 'In queue' : 'PlayFool')}
                      </Text>
                    </View>
                    {s._from === 'queue' && (
                      <>
                        <TouchableOpacity onPress={() => playFromQueue(i)} hitSlop={8} style={styles.queueBtn}>
                          <Ionicons name="play" size={18} color={theme.green} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeFromQueue(i)} hitSlop={8} style={styles.queueBtn}>
                          <Ionicons name="close" size={18} color={theme.textMuted} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ))
              )}
            </View>
          )}

          {tab === 'lyrics' && (
            <View style={styles.tabContent}>
              {lyrics.status === 'loading' && (
                <View style={styles.lyricsCenter}>
                  <ActivityIndicator size="small" color={theme.green} />
                  <Text style={styles.empty}>Searching lyrics...</Text>
                </View>
              )}
              {lyrics.status === 'unparseable' && (
                <View style={styles.lyricsCenter}>
                  <Ionicons name="search-outline" size={40} color={theme.textMuted} />
                  <Text style={styles.lyricsTitle}>Can't search lyrics</Text>
                  <Text style={styles.lyricsHint}>The file name needs to be 'Artist - Title'.</Text>
                </View>
              )}
              {lyrics.status === 'notfound' && (
                <View style={styles.lyricsCenter}>
                  <Ionicons name="musical-notes-outline" size={40} color={theme.textMuted} />
                  <Text style={styles.lyricsTitle}>No lyrics found</Text>
                  <Text style={styles.lyricsHint}>This track isn't in our lyrics database yet.</Text>
                </View>
              )}
              {lyrics.status === 'ok' && (
                <Text style={styles.lyricsBody}>{lyrics.text}</Text>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bgPrimary },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, paddingTop: 32,
    backgroundColor: theme.bgPrimary,
  },
  topLabel: { color: theme.textSecondary, fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' },
  scroll: { paddingBottom: 40 },
  coverWrap: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, marginTop: 8, marginBottom: 24,
  },
  cover: {
    width: '100%', aspectRatio: 1, borderRadius: 12,
    backgroundColor: theme.bgSurface,
    shadowColor: theme.green, shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  meta: { paddingHorizontal: 24, marginBottom: 18 },
  songTitle: { color: theme.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  artist: { color: theme.textSecondary, fontSize: 14 },
  progressRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 24, marginBottom: 14,
  },
  progressTrack: {
    flex: 1, height: 4, backgroundColor: theme.bgSurface, borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: theme.green, borderRadius: 2 },
  time: { color: theme.textMuted, fontSize: 11, fontVariant: ['tabular-nums'], width: 40, textAlign: 'center' },
  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, marginBottom: 28,
  },
  playBtn: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: theme.green,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: theme.green, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  repeatOneDot: {
    position: 'absolute', top: 6, right: 4,
    width: 4, height: 4, borderRadius: 2, backgroundColor: theme.green,
  },
  tabRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border,
    paddingHorizontal: 24, marginBottom: 8,
  },
  tabBtn: { paddingVertical: 12, paddingHorizontal: 16, marginRight: 8 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: theme.green },
  tabText: { color: theme.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  tabTextActive: { color: theme.green },
  tabContent: { paddingHorizontal: 24, paddingTop: 8, minHeight: 120 },
  empty: { color: theme.textMuted, textAlign: 'center', paddingVertical: 24, fontSize: 13 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  queueNum: { color: theme.textMuted, width: 22, textAlign: 'center', fontSize: 12 },
  queueInfo: { flex: 1, minWidth: 0 },
  queueTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: '500' },
  queueArtist: { color: theme.textSecondary, fontSize: 11, marginTop: 1 },
  queueBtn: { padding: 6 },
  lyricsCenter: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  lyricsTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 10 },
  lyricsHint: { color: theme.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  lyricsBody: { color: theme.textPrimary, fontSize: 14, lineHeight: 22 },
});
