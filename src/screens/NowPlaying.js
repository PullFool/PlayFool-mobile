import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  View, Text, Image, TouchableOpacity, Modal, StyleSheet,
  ScrollView, ActivityIndicator, FlatList, Alert, PanResponder,
  LayoutAnimation, UIManager, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../utils/theme';
import { usePlayer } from '../context/PlayerContext';
import { reportError } from '../utils/errorReporter';
import { fetchLrclibResults, lyricsKey } from '../utils/lyrics';

// LayoutAnimation on Android needs this opt-in to animate the
// expand/collapse of the Now Playing header.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  // Trust lrclib's relevance order — take the top result. Hunting for the
  // first synced result instead used to surface a wrong song just because
  // it happened to have timed lyrics.
  const pick = eligible[0];
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
// Tapping a line seeks to its timestamp. Wrapped in React.memo so the
// seek-bar drag (which re-renders the parent ~60x/s) doesn't re-render
// the lyrics list — position only changes at the useProgress poll rate.
const KaraokeLyrics = memo(function KaraokeLyrics({ lines, position, onSeek }) {
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
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingVertical: 60, paddingHorizontal: 24 }}
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
});

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
  // Seek-bar drag state.
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  // After release, hold the bar at the dropped fraction until the player's
  // reported position actually catches up — otherwise the bar snaps back
  // to the stale polled value for a frame.
  const [postSeekTarget, setPostSeekTarget] = useState(null);
  // collapsed = the big artwork is folded into a compact mini player at the
  // top, freeing space for the queue list / lyrics.
  const [collapsed, setCollapsed] = useState(false);

  // Reset to upnext tab + expanded artwork whenever the modal opens
  useEffect(() => {
    if (visible) { setTab('upnext'); setCollapsed(false); }
  }, [visible]);

  // Expand/collapse the header with a smooth layout animation.
  // Skipping LayoutAnimation here — animating the expanded-to-mini transition
  // on Android crashes natively when the mini header carries a flex row with
  // the new current/duration time texts. No JS-visible error reaches the
  // Discord reporter because the failure happens in the native animation
  // pipeline. Without the animation the transition is instant but stable.
  const setCollapsedAnimated = (val) => {
    setCollapsed(val);
  };

  // Scrolling the content list folds the artwork into the mini player.
  const handleContentScroll = (e) => {
    if (!collapsed && e.nativeEvent.contentOffset.y > 12) setCollapsedAnimated(true);
  };

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

  // Wipe the reject list for this song and re-fetch from the top — so a user
  // who blew past the correct match while spamming "Try next" can recover.
  const resetRejected = async () => {
    if (!lyrics?.songKey) return;
    await saveRejected(lyrics.songKey, []);
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
  // Memoised so the high-frequency re-renders from a seek-bar drag don't
  // rebuild the entire array.
  const upcoming = useMemo(() => {
    const list = [];
    for (const q of queue) list.push({ ...q, _from: 'queue' });
    for (let i = 0; i < songs.length; i++) {
      list.push({ ...songs[i], _from: 'songs', _idx: i });
    }
    return list;
  }, [queue, songs]);

  // The list JSX is memoised separately — it only depends on the list
  // contents and the currently-playing index (for highlight/dim styling).
  // Seek-bar drags re-render NowPlaying ~60x/s but the deps here don't
  // change, so the heavy .map() is reused and the drag stays smooth.
  const upcomingList = useMemo(() => {
    if (upcoming.length === 0) {
      return <Text style={styles.empty}>Nothing up next.</Text>;
    }
    return upcoming.map((s, i) => {
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
    });
  }, [upcoming, currentIndex, playAtIndex, playFromQueue, removeFromQueue]);

  const livePosition = duration ? Math.min(1, position / duration) : 0;
  // While the user is dragging the seek bar we show seekValue instead of the
  // live playback position, so the thumb tracks the finger smoothly. After
  // release we keep showing postSeekTarget until livePosition catches up.
  const progress = seeking
    ? seekValue
    : (postSeekTarget != null ? postSeekTarget : livePosition);
  // Same hold logic for the time text so it doesn't snap to the stale
  // position for a frame after the user lets go.
  const displayPosition = seeking
    ? seekValue * duration
    : (postSeekTarget != null ? postSeekTarget * duration : position);

  // Clear the post-seek hold once playback position is within ~2% of the
  // dropped target. A 1.5s safety timer releases the hold if the player
  // never reports a matching position.
  useEffect(() => {
    if (postSeekTarget == null) return;
    if (duration && Math.abs(position / duration - postSeekTarget) < 0.02) {
      setPostSeekTarget(null);
      return;
    }
    const t = setTimeout(() => setPostSeekTarget(null), 1500);
    return () => clearTimeout(t);
  }, [position, duration, postSeekTarget]);

  // Seek-bar geometry measured in WINDOW coordinates. Using absolute screen
  // X (gestureState.x0 / moveX) instead of nativeEvent.locationX avoids the
  // flicker that happened when the finger passed over the thumb child view —
  // locationX would then report relative to that 14px view.
  const trackRef = useRef(null);
  const seekRef = useRef({ x: 0, width: 1, duration: 0 });
  seekRef.current.duration = duration;

  const measureTrack = () => {
    const node = trackRef.current;
    if (node && node.measureInWindow) {
      node.measureInWindow((x, y, w) => {
        if (w > 0) { seekRef.current.x = x; seekRef.current.width = w; }
      });
    }
  };

  const seekFraction = (screenX) => {
    const { x, width } = seekRef.current;
    return Math.min(1, Math.max(0, (screenX - x) / (width || 1)));
  };

  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e, g) => {
        setSeeking(true);
        setSeekValue(seekFraction(g.x0));
      },
      onPanResponderMove: (e, g) => {
        setSeekValue(seekFraction(g.moveX));
      },
      onPanResponderRelease: (e, g) => {
        const f = seekFraction(g.moveX);
        setSeekValue(f);
        seekTo(f * (seekRef.current.duration || 0));
        setPostSeekTarget(f);
        setSeeking(false);
      },
      onPanResponderTerminate: () => setSeeking(false),
    })
  ).current;

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

        {/* Header — full artwork (expanded) or compact mini player (collapsed) */}
        {collapsed ? (
          <View style={styles.miniHeader}>
            <View style={styles.miniRow}>
              <TouchableOpacity
                style={styles.miniTap}
                onPress={() => setCollapsedAnimated(false)}
                activeOpacity={0.7}
              >
                {currentSong?.cover ? (
                  <Image source={{ uri: currentSong.cover }} style={styles.miniThumb} />
                ) : (
                  <View style={[styles.miniThumb, styles.coverFallback]}>
                    <Ionicons name="musical-notes" size={18} color={theme.green} />
                  </View>
                )}
                <View style={styles.miniText}>
                  <Text style={styles.miniTitle} numberOfLines={1}>
                    {currentSong?.title || 'No song playing'}
                  </Text>
                  <Text style={styles.miniArtist} numberOfLines={1}>
                    {currentSong?.artist || 'PlayFool'}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={skipPrev} hitSlop={8} style={styles.miniBtn}>
                <Ionicons name="play-skip-back" size={22} color={theme.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlayPause} hitSlop={8} style={styles.miniBtn}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color={theme.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={skipNext} hitSlop={8} style={styles.miniBtn}>
                <Ionicons name="play-skip-forward" size={22} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.miniProgressRow}>
              <Text style={styles.miniTime}>{fmt(displayPosition)}</Text>
              <View
                ref={trackRef}
                style={styles.miniProgressTouch}
                onLayout={measureTrack}
                {...seekPan.panHandlers}
              >
                <View style={styles.miniProgressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <View style={[styles.miniProgressThumb, { left: `${progress * 100}%` }]} />
              </View>
              <Text style={styles.miniTime}>{fmt(duration)}</Text>
            </View>
          </View>
        ) : (
          <View>
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

            {/* Progress — draggable seek bar */}
            <View style={styles.progressRow}>
              <Text style={styles.time}>{fmt(displayPosition)}</Text>
              <View
                ref={trackRef}
                style={styles.progressTouch}
                onLayout={measureTrack}
                {...seekPan.panHandlers}
              >
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                </View>
                <View style={[styles.progressThumb, { left: `${progress * 100}%` }, seeking && styles.progressThumbActive]} />
              </View>
              <Text style={styles.time}>{fmt(duration)}</Text>
            </View>

            {/* Controls */}
            <View style={styles.controls}>
              <TouchableOpacity onPress={toggleShuffle} hitSlop={8}>
                <Ionicons name="shuffle" size={22} color={shuffle ? theme.green : theme.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={skipPrev} hitSlop={8}>
                <Ionicons name="play-skip-back" size={30} color={theme.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={togglePlayPause} style={styles.playBtn}>
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity onPress={skipNext} hitSlop={8}>
                <Ionicons name="play-skip-forward" size={30} color={theme.textPrimary} />
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
          </View>
        )}

        {/* Tabs — fixed */}
        <View style={styles.tabRow}>
          {['upnext', 'lyrics'].map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => { setTab(t); if (t === 'lyrics') setCollapsedAnimated(true); }}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'upnext' ? 'Up Next' : 'Lyrics'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content — the Up Next list scrolls (and folds the header);
            the Lyrics tab is a flex area so lyrics fill to the bottom. */}
        {tab === 'upnext' ? (
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            onScroll={handleContentScroll}
            scrollEventThrottle={16}
          >
            <View style={styles.tabContent}>
              {upcomingList}
            </View>
          </ScrollView>
        ) : (
          <View style={styles.lyricsArea}>
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
                  <TouchableOpacity onPress={resetRejected} style={styles.startOverBtn}>
                    <Ionicons name="refresh" size={14} color={theme.green} />
                    <Text style={styles.startOverText}>Start over</Text>
                  </TouchableOpacity>
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
                  {lyrics.lines && lyrics.lines.length > 0 ? (
                    <KaraokeLyrics lines={lyrics.lines} position={position} onSeek={seekTo} />
                  ) : (
                    <ScrollView
                      style={{ flex: 1 }}
                      contentContainerStyle={styles.lyricsBodyWrap}
                      showsVerticalScrollIndicator={false}
                    >
                      <Text style={styles.lyricsBody}>{lyrics.text}</Text>
                    </ScrollView>
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
  contentScroll: { flex: 1 },
  // Collapsed mini player.
  miniHeader: {
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  miniThumb: { width: 46, height: 46, borderRadius: 6, backgroundColor: theme.bgSurface },
  miniText: { flex: 1, minWidth: 0 },
  miniTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '700' },
  miniArtist: { color: theme.textSecondary, fontSize: 12, marginTop: 1 },
  miniBtn: { padding: 6 },
  miniProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  miniProgressTouch: { flex: 1, height: 16, justifyContent: 'center' },
  miniTime: { color: theme.textMuted, fontSize: 10, fontVariant: ['tabular-nums'], width: 34, textAlign: 'center' },
  miniProgressTrack: { height: 3, backgroundColor: theme.bgSurface, borderRadius: 2, overflow: 'hidden' },
  miniProgressThumb: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: theme.green, marginLeft: -5, top: 3,
  },
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
  // Tall transparent hit-area so the 4px bar is easy to grab and drag.
  progressTouch: {
    flex: 1, height: 24, justifyContent: 'center',
  },
  progressTrack: {
    height: 4, backgroundColor: theme.bgSurface, borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: theme.green, borderRadius: 2 },
  progressThumb: {
    position: 'absolute',
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: theme.green,
    marginLeft: -7,
    top: 5,
  },
  progressThumbActive: { transform: [{ scale: 1.35 }] },
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
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: theme.green },
  tabText: { color: theme.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  tabTextActive: { color: theme.green },
  tabContent: { paddingHorizontal: 24, paddingTop: 8, minHeight: 120 },
  // Lyrics tab fills all remaining height so lyrics reach the bottom.
  lyricsArea: { flex: 1 },
  lyricsBodyWrap: { paddingHorizontal: 24, paddingVertical: 16, paddingBottom: 40 },
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
  lyricsCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  startOverBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16, paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 16, borderWidth: 1, borderColor: theme.green,
  },
  startOverText: { color: theme.green, fontSize: 13, fontWeight: '700' },
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
