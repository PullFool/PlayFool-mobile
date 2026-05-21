import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
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
  const { currentSong, isPlaying, position, duration, togglePlayPause, skipNext, skipPrev } = usePlayer();
  const [showLyrics, setShowLyrics] = useState(false);

  if (!currentSong) return null;
  const progress = duration ? (position / duration) * 100 : 0;

  return (
    <View style={styles.bar}>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
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
  progress: { height: 3, backgroundColor: theme.bgSurface, borderRadius: 2, marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: theme.green, borderRadius: 2 },
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
