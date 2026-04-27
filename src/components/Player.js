import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayer } from '../context/PlayerContext';
import { theme } from '../utils/theme';

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export default function Player() {
  const { currentSong, isPlaying, position, duration, togglePlayPause, skipNext, skipPrev, seekTo } = usePlayer();

  if (!currentSong) return null;
  const progress = duration ? (position / duration) * 100 : 0;

  return (
    <View style={styles.bar}>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <View style={styles.row}>
        {currentSong.cover ? (
          <Image source={{ uri: currentSong.cover }} style={styles.art} />
        ) : (
          <View style={styles.art}><Ionicons name="musical-notes" size={20} color={theme.textMuted} /></View>
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{currentSong.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{currentSong.artist || 'Unknown'}</Text>
        </View>
        <View style={styles.controls}>
          <TouchableOpacity onPress={skipPrev}><Ionicons name="play-skip-back" size={22} color={theme.textPrimary} /></TouchableOpacity>
          <TouchableOpacity onPress={() => seekTo(Math.max(0, position - 10))}><Ionicons name="play-back" size={20} color={theme.textPrimary} /></TouchableOpacity>
          <TouchableOpacity onPress={togglePlayPause} style={styles.playBtn}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => seekTo(position + 10)}><Ionicons name="play-forward" size={20} color={theme.textPrimary} /></TouchableOpacity>
          <TouchableOpacity onPress={skipNext}><Ionicons name="play-skip-forward" size={22} color={theme.textPrimary} /></TouchableOpacity>
        </View>
      </View>
      <Text style={styles.time}>{fmt(position)} / {fmt(duration)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: theme.bgSecondary, borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 12, paddingVertical: 8 },
  progress: { height: 3, backgroundColor: theme.bgSurface, borderRadius: 2, marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: theme.green, borderRadius: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  art: { width: 40, height: 40, borderRadius: 4, backgroundColor: theme.bgSurface, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  title: { color: theme.textPrimary, fontSize: 13, fontWeight: '600' },
  artist: { color: theme.textSecondary, fontSize: 11 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.green, alignItems: 'center', justifyContent: 'center' },
  time: { color: theme.textMuted, fontSize: 10, textAlign: 'right', marginTop: 4 },
});
