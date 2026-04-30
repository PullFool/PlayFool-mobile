import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import { reportError } from '../utils/errorReporter';

const PlayerContext = createContext();
export const usePlayer = () => useContext(PlayerContext);

export function PlayerProvider({ children }) {
  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(0); // 0 off, 1 all, 2 one
  const [queue, setQueue] = useState([]);

  const soundRef = useRef(null);
  const currentSong = currentIndex >= 0 ? songs[currentIndex] : null;

  // Configure audio session for background playback on Android
  useEffect(() => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch((e) => reportError('audio.setMode', e));
  }, []);

  const unload = async () => {
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch(e) {}
      soundRef.current = null;
    }
  };

  const playSong = useCallback(async (songList, index) => {
    setSongs(songList);
    setCurrentIndex(index);
    const song = songList[index];
    if (!song) return;

    await unload();

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: song.url },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          setIsPlaying(status.isPlaying);
          setPosition(status.positionMillis / 1000);
          setDuration((status.durationMillis || 0) / 1000);
          if (status.didJustFinish) {
            // auto-advance handled below via skipNext
            skipNextRef.current && skipNextRef.current();
          }
        }
      );
      soundRef.current = sound;
    } catch (e) {
      reportError('player.playSong', e, { songUrl: song.url, title: song.title });
      console.error('Play failed:', e);
    }
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (!soundRef.current) return;
    if (isPlaying) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  }, [isPlaying]);

  const skipNext = useCallback(() => {
    if (queue.length > 0) {
      const next = queue[0];
      setQueue((q) => q.slice(1));
      playSong([next], 0);
      return;
    }
    if (songs.length === 0) return;
    let next;
    if (shuffle) next = Math.floor(Math.random() * songs.length);
    else {
      next = (currentIndex + 1) % songs.length;
      if (next === 0 && repeat === 0) {
        soundRef.current?.pauseAsync();
        return;
      }
    }
    playSong(songs, next);
  }, [songs, currentIndex, shuffle, repeat, queue, playSong]);

  const skipNextRef = useRef(skipNext);
  useEffect(() => { skipNextRef.current = skipNext; }, [skipNext]);

  const skipPrev = useCallback(() => {
    if (songs.length === 0) return;
    if (position > 3) {
      soundRef.current?.setPositionAsync(0);
      return;
    }
    const prev = (currentIndex - 1 + songs.length) % songs.length;
    playSong(songs, prev);
  }, [songs, currentIndex, position, playSong]);

  const seekTo = useCallback(async (seconds) => {
    if (soundRef.current) await soundRef.current.setPositionAsync(seconds * 1000);
  }, []);

  const shufflePlay = useCallback((songList) => {
    if (!songList.length) return;
    const shuffled = [...songList].sort(() => Math.random() - 0.5);
    setShuffle(true);
    playSong(shuffled, 0);
  }, [playSong]);

  const value = {
    songs, currentSong, currentIndex, isPlaying, position, duration,
    shuffle, repeat, queue,
    playSong, shufflePlay, togglePlayPause, skipNext, skipPrev, seekTo,
    toggleShuffle: () => setShuffle((s) => !s),
    toggleRepeat: () => setRepeat((r) => (r + 1) % 3),
    addToQueue: (song) => setQueue((q) => [...q, song]),
    playNext: (song) => setQueue((q) => [song, ...q]),
    removeFromQueue: (index) => setQueue((q) => q.filter((_, i) => i !== index)),
    playFromQueue: (index) => {
      setQueue((q) => {
        const song = q[index];
        if (song) playSong([song], 0);
        return q.filter((_, i) => i !== index);
      });
    },
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
