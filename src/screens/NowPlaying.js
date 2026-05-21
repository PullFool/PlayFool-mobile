import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, Modal, StyleSheet,
  ScrollView, ActivityIndicator, FlatList, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';
import { fetchLrclibResults, lyricsKey } from '../utils/lyrics';

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

const REJECT_KEY = 'playfool_mobile_lyrics_rejected';

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

// Convert "[mm:ss.xx]Lyric line" lrclib output into [{ time, text }].
function parseSyncedLyrics(lrc) {
  const out = [];
  for (const raw of String(lrc).split('\n')) {
    const m = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (!m) continue;
    const minutes = parseInt(m[1], 10);
    const seconds = parseInt(m[2], 10);
    const ms = parseInt(m[3].padEnd(3, '0'), 10);
    const time = minutes * 60 + seconds + ms / 1000;
    const text = m[4].trim();
    if (text) out.push({ time, text });
  }
  return out.length ? out : null;
}

async function loadLyricsForSong(song) {
  const key = lyricsKey(song.title);
  if (!key) return { status: 'notfound' };
  const rejected = await loadRejected(key);

  // Walk lrclib search variants the same way the desktop app does, so songs
  // without a clean "Artist - Title" name still resolve.
  let results = [];
  try {
    results = await fetchLrclibResults(song.title);
  } catch (e) {
    return { status: 'error' };
  }
  if (results.length === 0) return { status: 'notfound' };

  const rejectedSet = new Set((rejected || []).map(String));
  const eligible = results
    .map((r, i) => ({ ...r, _index: i }))
    .filter((r) => !rejectedSet.has(String(r.id)));
  if (!eligible.length) return { status: rejected.length ? 'noMore' : 'notfound' };
  const pick = eligible.find((r) => r.syncedLyrics) || eligible[0];
  const synced = pick.syncedLyrics ? parseSyncedLyrics(pick.syncedLyrics) : null;
  const plain = pick.plainLyrics
    || (pick.syncedLyrics && pick.syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim())
    || '';
  if (!synced && !plain) return { status: 'notfound' };
  return {
    status: 'ok',
    lines: synced || null,
    text: plain,
    sourceId: String(pick.id),
    total: results.length,
    current: pick._index + 1,
    songKey: key,
  };
}

// Karaoke-style synced lyric renderer. Highlights the current line based
// on playback position and auto-scrolls so the active line stays centered.
// Tapping a line seeks to its timestamp.
function KaraokeLyrics({ lines, position, onSeek }) {
  const scrollRef = useRef(null);
  const [lineHeights, setLineHeights] = useState({});

  let activeIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (position >= lines[i].time) { activeIndex = i; break; }
  }

  useEffect(() => {
    if (activeIndex < 0 || !scrollRef.current) return;
    let y = 0;
    for (let i = 0; i < activeIndex; i++) y += lineHeights[i] || 28;
    // Center-ish within the visible area.
    const target = Math.max(0, y - 120);
    scrollRef.current.scrollTo({ y: target, animated: true });
  }, [activeIndex, lineHeights]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ maxHeight: 420 }}
      contentContainerStyle={{ paddingVertical: 60 }}
      showsVerticalScrollIndicator={false}
    >
      {lines.map((line, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => onSeek && onSeek(line.time)}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            setLineHeights((prev) => (prev[i] === h ? prev : { ...prev, [i]: h }));
          }}
        >
          <Text
            style={[
              styles.karaokeLine,
              i === activeIndex && styles.karaokeLineActive,
              i < activeIndex && styles.karaokeLinePast,
            ]}
          >
            {line.text}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function NowPlaying({ visible, onClose }) {
  const {
    currentSong, isPlaying, position, duration, queue, songs, currentIndex,
    shuffle, repeat,
    togglePlayPause, skipNext, skipPrev, seekTo,
    toggleShuffle, toggleRepeat,
    removeFromQueue, playFromQueue, playAtIndex,
  } = usePlayer();

  const [tab, setTab] = useState('upnext');
  const [lyrics, setLyrics] = useState({ status: 'idle', text: '' });
  const lastSongIdRef = useRef(null);

  // Reset to upnext tab whenever the modal opens
  useEffect(() => { if (visible) setTab('upnext'); }, [visible]);

  const reloadLyrics = useCallback(() => {
    if (!currentSong) return;
    setLyrics({ status: 'loading', text: '' });
    loadLyricsForSong(currentSong)
      .then((r) => setLyrics(r))
      .catch((e) => { reportError('nowplaying.lyrics', e); setLyrics({ status: 'notfound' }); });
  }, [currentSong]);

  // Load lyrics when the lyrics tab is opened or the song changes
  useEffect(() => {
    if (!visible || tab !== 'lyrics' || !currentSong) return;
    if (lastSongIdRef.current === currentSong.id && lyrics.status !== 'idle') return;
    lastSongIdRef.current = currentSong.id;
    reloadLyrics();
  }, [visible, tab, currentSong, reloadLyrics, lyrics.status]);

  const skipMatch = async () => {
    if (!lyrics?.songKey || !lyrics?.sourceId) return;
    const next = Array.from(new Set([...(await loadRejected(lyrics.songKey)), lyrics.sourceId]));
    await saveRejected(lyrics.songKey, next);
    reloadLyrics();
  };

  const markWrong = () => {
    if (!lyrics?.songKey || !lyrics?.sourceId) return;
    Alert.alert(
      'Mark lyrics as wrong?',
      "We won't show this match for this song again.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, skip these', style: 'destructive', onPress: skipMatch },
      ],
    );
  };

  // The queue shows the WHOLE playlist — already-played, current, and
  // upcoming — so the user can tap back to a finished song. Each playlist
  // row keeps its real index, so numbering never shifts as songs play.
  const upcoming = (() => {
    const list = [];
    for (const q of queue) list.push({ ...q, _from: 'queue' });
    for (let i = 0; i < songs.length; i++) {
      list.push({ ...songs[i], _from: 'songs', _idx: i });
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
                upcoming.map((s, i) => {
                  const isQueue = s._from === 'queue';
                  const isCurrent = !isQueue && s._idx === currentIndex;
                  const isPlayed = !isQueue && s._idx < currentIndex;
                  const RowWrap = isQueue ? View : TouchableOpacity;
                  const rowProps = isQueue
                    ? {}
                    : { onPress: () => playAtIndex(s._idx), activeOpacity: 0.6 };
                  return (
                    <RowWrap
                      key={`${s.id}-${i}`}
                      style={[styles.queueRow, isPlayed && styles.queueRowPlayed]}
                      {...rowProps}
                    >
                      {isCurrent ? (
                        <Ionicons name="volume-medium" size={15} color={theme.green} style={styles.queueNumSlot} />
                      ) : (
                        <Text style={[styles.queueNum, isQueue && styles.queueNumQ]}>
                          {isQueue ? '•' : s._idx + 1}
                        </Text>
                      )}
                      <View style={styles.queueInfo}>
                        <Text
                          style={[styles.queueTitle, isCurrent && styles.queueTitleCurrent]}
                          numberOfLines={1}
                        >
                          {s.title}
                        </Text>
                        <Text style={styles.queueArtist} numberOfLines={1}>
                          {s.artist || (isQueue ? 'In queue' : 'PlayFool')}
                        </Text>
                      </View>
                      {isQueue && (
                        <>
                          <TouchableOpacity onPress={() => playFromQueue(i)} hitSlop={8} style={styles.queueBtn}>
                            <Ionicons name="play" size={18} color={theme.green} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => removeFromQueue(i)} hitSlop={8} style={styles.queueBtn}>
                            <Ionicons name="close" size={18} color={theme.textMuted} />
                          </TouchableOpacity>
                        </>
                      )}
                    </RowWrap>
                  );
                })
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
              {lyrics.status === 'notfound' && (
                <View style={styles.lyricsCenter}>
                  <Ionicons name="musical-notes-outline" size={40} color={theme.textMuted} />
                  <Text style={styles.lyricsTitle}>No lyrics found</Text>
                  <Text style={styles.lyricsHint}>This track isn't in our lyrics database yet.</Text>
                </View>
              )}
              {lyrics.status === 'noMore' && (
                <View style={styles.lyricsCenter}>
                  <Ionicons name="musical-notes-outline" size={40} color={theme.textMuted} />
                  <Text style={styles.lyricsTitle}>No more matches to try</Text>
                  <Text style={styles.lyricsHint}>You've rejected all matches for this song.</Text>
                </View>
              )}
              {lyrics.status === 'error' && (
                <View style={styles.lyricsCenter}>
                  <Ionicons name="cloud-offline-outline" size={40} color={theme.textMuted} />
                  <Text style={styles.lyricsTitle}>Couldn't load lyrics</Text>
                  <Text style={styles.lyricsHint}>Check your connection and try again.</Text>
                </View>
              )}
              {lyrics.status === 'ok' && (
                <>
                  {/* Compact player so the user can pause/skip while reading lyrics */}
                  <View style={styles.miniPlayer}>
                    {currentSong?.cover ? (
                      <Image source={{ uri: currentSong.cover }} style={styles.miniThumb} />
                    ) : (
                      <View style={[styles.miniThumb, styles.coverFallback]}>
                        <Ionicons name="musical-notes" size={20} color={theme.green} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniTitle} numberOfLines={1}>
                        {currentSong?.title || ''}
                      </Text>
                      <Text style={styles.miniArtist} numberOfLines={1}>
                        {currentSong?.artist || 'PlayFool'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={togglePlayPause} style={styles.miniBtn} hitSlop={8}>
                      <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={theme.textPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={skipNext} style={styles.miniBtn} hitSlop={8}>
                      <Ionicons name="play-skip-forward" size={22} color={theme.textPrimary} />
                    </TouchableOpacity>
                  </View>
                  {lyrics.lines && lyrics.lines.length > 0 ? (
                    <KaraokeLyrics lines={lyrics.lines} position={position} onSeek={seekTo} />
                  ) : (
                    <Text style={styles.lyricsBody}>{lyrics.text}</Text>
                  )}
                  {lyrics.total > 0 && (
                    <View style={styles.matchBar}>
                      <Text style={styles.matchSource}>
                        lrclib · {lyrics.current}/{lyrics.total}
                      </Text>
                      <View style={styles.matchActions}>
                        <TouchableOpacity
                          onPress={skipMatch}
                          disabled={lyrics.total <= lyrics.current}
                          style={[styles.matchBtn, lyrics.total <= lyrics.current && styles.matchBtnDisabled]}
                        >
                          <Ionicons name="play-skip-forward" size={11} color={theme.textSecondary} />
                          <Text style={styles.matchBtnText}>Try next</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={markWrong} style={styles.matchBtn}>
                          <Ionicons name="thumbs-down" size={11} color={theme.textSecondary} />
                          <Text style={styles.matchBtnText}>Wrong</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </>
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
  queueRowPlayed: { opacity: 0.4 },
  queueNum: { color: theme.textMuted, width: 22, textAlign: 'center', fontSize: 12 },
  queueNumQ: { color: theme.green, fontSize: 16 },
  queueNumSlot: { width: 22, textAlign: 'center' },
  queueInfo: { flex: 1, minWidth: 0 },
  queueTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: '500' },
  queueTitleCurrent: { color: theme.green, fontWeight: '700' },
  queueArtist: { color: theme.textSecondary, fontSize: 11, marginTop: 1 },
  queueBtn: { padding: 6 },
  lyricsCenter: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  lyricsTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 10 },
  lyricsHint: { color: theme.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  lyricsBody: { color: theme.textPrimary, fontSize: 14, lineHeight: 22 },
  // Spotify-style karaoke: chunky bold active line, big light-gray future
  // lines, very faded past lines. Left-aligned so multi-line lyrics wrap
  // naturally instead of looking centered and weird.
  karaokeLine: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 19, lineHeight: 27, fontWeight: '700',
    paddingVertical: 6, paddingHorizontal: 4,
    textAlign: 'left',
  },
  karaokeLineActive: {
    color: '#fff',
    fontSize: 22, lineHeight: 30, fontWeight: '800',
  },
  karaokeLinePast: {
    color: 'rgba(255, 255, 255, 0.22)',
  },
  miniPlayer: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4,
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
  miniThumb: { width: 44, height: 44, borderRadius: 6, backgroundColor: theme.bgSurface },
  miniTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '700' },
  miniArtist: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  miniBtn: { padding: 6 },
  matchBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, paddingVertical: 8, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: theme.border,
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
