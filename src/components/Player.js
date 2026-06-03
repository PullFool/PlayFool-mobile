import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayer } from '../context/PlayerContext';
import { theme } from '../utils/theme';
import LyricsModal from './LyricsModal';

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export default function Player({ onExpand }) {
  const { currentSong, isPlaying, position, duration, togglePlayPause, skipNext, skipPrev, seekTo } = usePlayer();
  const [showLyrics, setShowLyrics] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  // After release, hold the bar at the dropped fraction until the player
  // actually catches up — same pattern as the Now Playing seek bar.
  const [postSeekTarget, setPostSeekTarget] = useState(null);

  // Draggable seek bar — measured in window coords, driven by absolute
  // screen X (gestureState) so it doesn't flicker over the thumb.
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
      onPanResponderGrant: (e, g) => { setSeeking(true); setSeekValue(seekFraction(g.x0)); },
      onPanResponderMove: (e, g) => { setSeekValue(seekFraction(g.moveX)); },
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

  // Release the post-seek hold once playback reaches the dropped target,
  // with a 1.5s safety fallback in case TrackPlayer never reports it.
  useEffect(() => {
    if (postSeekTarget == null) return;
    if (duration && Math.abs(position / duration - postSeekTarget) < 0.02) {
      setPostSeekTarget(null);
      return;
    }
    const t = setTimeout(() => setPostSeekTarget(null), 1500);
    return () => clearTimeout(t);
  }, [position, duration, postSeekTarget]);

  if (!currentSong) return null;
  const livePos = duration ? Math.min(1, position / duration) : 0;
  const progress = seeking
    ? seekValue
    : (postSeekTarget != null ? postSeekTarget : livePos);

  return (
    <View style={styles.bar}>
      <View
        ref={trackRef}
        style={styles.progressTouch}
        onLayout={measureTrack}
        {...seekPan.panHandlers}
      >
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.progressThumb, { left: `${progress * 100}%` }]} />
      </View>
      <View style={styles.row}>
        <TouchableOpacity onPress={onExpand} style={styles.tappable}>
          {currentSong.cover ? (
            <Image source={{ uri: currentSong.cover }} style={styles.art} />
          ) : (
            <View style={styles.art}><Ionicons name="musical-notes" size={20} color={theme.textMuted} /></View>
          )}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>{currentSong.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{currentSong.artist || 'Unknown'}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.controls}>
          <TouchableOpacity onPress={skipPrev}><Ionicons name="play-skip-back" size={24} color={theme.textPrimary} /></TouchableOpacity>
          <TouchableOpacity onPress={togglePlayPause} style={styles.playBtn}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity onPress={skipNext}><Ionicons name="play-skip-forward" size={24} color={theme.textPrimary} /></TouchableOpacity>
        </View>
      </View>
      <View style={styles.bottomRow}>
        <TouchableOpacity onPress={() => setShowLyrics(true)} style={styles.lyricsBtn}>
          <Ionicons name="document-text-outline" size={14} color={theme.textMuted} />
          <Text style={styles.lyricsBtnText}>Lyrics</Text>
        </TouchableOpacity>
        <Text style={styles.time}>{fmt(position)} / {fmt(duration)}</Text>
      </View>
      <LyricsModal open={showLyrics} song={currentSong} onClose={() => setShowLyrics(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: theme.bgSecondary, borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 12, paddingVertical: 8 },
  progressTouch: { height: 18, justifyContent: 'center', marginBottom: 2 },
  progress: { height: 3, backgroundColor: theme.bgSurface, borderRadius: 2 },
  progressFill: { height: '100%', backgroundColor: theme.green, borderRadius: 2 },
  progressThumb: {
    position: 'absolute',
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: theme.green,
    marginLeft: -5.5, top: 3.5,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tappable: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  art: { width: 40, height: 40, borderRadius: 4, backgroundColor: theme.bgSurface, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { color: theme.textPrimary, fontSize: 13, fontWeight: '600' },
  artist: { color: theme.textSecondary, fontSize: 11 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.green, alignItems: 'center', justifyContent: 'center' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  lyricsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  lyricsBtnText: { color: theme.textMuted, fontSize: 11 },
  time: { color: theme.textMuted, fontSize: 10 },
});
