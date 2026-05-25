import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import TrackPlayer, {
  Capability, RepeatMode, Event, State, useTrackPlayerEvents, useProgress,
} from 'react-native-track-player';
import { reportError } from '../utils/errorReporter';
import { tick as crossfadeTick, abortCrossfade, loadCrossfadeSetting } from '../utils/crossfade';

const PlayerContext = createContext();
export const usePlayer = () => useContext(PlayerContext);

const PLAY_EVENTS = [
  Event.PlaybackState,
  Event.PlaybackActiveTrackChanged,
  Event.PlaybackError,
];

// Convert one of our song objects into a TrackPlayer Track shape
const toTrack = (song) => ({
  id: String(song.id),
  url: song.url,
  title: song.title || 'Unknown',
  artist: song.artist || 'PlayFool',
  artwork: song.cover || undefined,
  // Stash original song so we can read it back later
  __song: song,
});

let trackPlayerSetup = false;
async function setupTrackPlayerOnce() {
  if (trackPlayerSetup) return;
  await TrackPlayer.setupPlayer({
    autoHandleInterruptions: true,
  });
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: 'StopPlaybackAndRemoveNotification',
    },
    capabilities: [
      Capability.Play, Capability.Pause, Capability.Stop,
      Capability.SkipToNext, Capability.SkipToPrevious,
      Capability.SeekTo, Capability.JumpForward, Capability.JumpBackward,
    ],
    compactCapabilities: [
      Capability.Play, Capability.Pause,
      Capability.SkipToNext, Capability.SkipToPrevious,
    ],
    notificationCapabilities: [
      Capability.Play, Capability.Pause, Capability.Stop,
      Capability.SkipToNext, Capability.SkipToPrevious,
      Capability.SeekTo, Capability.JumpForward, Capability.JumpBackward,
    ],
    progressUpdateEventInterval: 1,
    forwardJumpInterval: 10,
    backwardJumpInterval: 10,
  });
  trackPlayerSetup = true;
}

export function PlayerProvider({ children }) {
  // Local mirror of TrackPlayer state so consumers (UI) re-render reactively.
  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(0); // 0 off, 1 all, 2 one
  const [queue, setQueue] = useState([]);

  const songsRef = useRef([]);
  const currentIndexRef = useRef(-1);

  // Keep refs in sync with state for use inside event handlers
  useEffect(() => { songsRef.current = songs; }, [songs]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // Initialize TrackPlayer on mount
  useEffect(() => {
    setupTrackPlayerOnce().catch((e) => reportError('player.setup', e));
    loadCrossfadeSetting();
  }, []);

  // Drive the crossfade controller from each progress tick.
  useEffect(() => {
    const cur = songs[currentIndex];
    const next = songs[currentIndex + 1];
    if (!cur || !next) return;
    crossfadeTick({
      position, duration,
      currentTrackId: cur.id,
      nextTrack: next,
    });
  }, [position, duration, songs, currentIndex]);

  // Apply repeat mode to TrackPlayer
  useEffect(() => {
    const map = {
      0: RepeatMode.Off,
      1: RepeatMode.Queue,
      2: RepeatMode.Track,
    };
    TrackPlayer.setRepeatMode(map[repeat] ?? RepeatMode.Off).catch(() => {});
  }, [repeat]);

  // Real-time playback state + position from TrackPlayer
  const { position, duration } = useProgress(250);

  useTrackPlayerEvents(PLAY_EVENTS, async (event) => {
    if (event.type === Event.PlaybackError) {
      reportError('player.playback', new Error(event.message || 'Playback error'), { code: event.code });
    }
    if (event.type === Event.PlaybackState) {
      const playing = event.state === State.Playing;
      setIsPlaying(playing);
    }
    if (event.type === Event.PlaybackActiveTrackChanged) {
      // Sync currentIndex from the active track id when TrackPlayer moves on its own
      try {
        const active = await TrackPlayer.getActiveTrack();
        if (!active) return;
        const idx = songsRef.current.findIndex((s) => String(s.id) === String(active.id));
        if (idx >= 0 && idx !== currentIndexRef.current) setCurrentIndex(idx);
      } catch (e) {}
    }
  });

  const currentSong = currentIndex >= 0 ? songs[currentIndex] : null;

  const playSong = useCallback(async (songList, index) => {
    try {
      await abortCrossfade();
      await setupTrackPlayerOnce();
      setSongs(songList);
      setCurrentIndex(index);
      const tracks = songList.map(toTrack);
      await TrackPlayer.reset();
      await TrackPlayer.add(tracks);
      if (index > 0) await TrackPlayer.skip(index);
      await TrackPlayer.play();
    } catch (e) {
      reportError('player.playSong', e, { title: songList?.[index]?.title });
    }
  }, []);

  const togglePlayPause = useCallback(async () => {
    try {
      const state = (await TrackPlayer.getPlaybackState()).state;
      if (state === State.Playing) await TrackPlayer.pause();
      else await TrackPlayer.play();
    } catch (e) {}
  }, []);

  const skipNext = useCallback(async () => {
    await abortCrossfade();
    // Manual queue takes priority — splice the next queued song in
    if (queue.length > 0) {
      const nextSong = queue[0];
      setQueue((q) => q.slice(1));
      await playSong([nextSong], 0);
      return;
    }
    if (songs.length === 0) return;
    // The songs array is already in play order — shufflePlay pre-shuffles it
    // once — so Next always advances sequentially. Re-randomizing on every
    // skip (the old behavior) made Next feel like it re-shuffled and could
    // replay or skip songs.
    const next = (currentIndex + 1) % songs.length;
    if (next === 0 && repeat === 0) {
      try { await TrackPlayer.pause(); } catch (e) {}
      return;
    }
    setCurrentIndex(next);
    try { await TrackPlayer.skip(next); await TrackPlayer.play(); } catch (e) {}
  }, [queue, songs, currentIndex, repeat, playSong]);

  const skipPrev = useCallback(async () => {
    await abortCrossfade();
    if (songs.length === 0) return;
    if (position > 3) {
      try { await TrackPlayer.seekTo(0); } catch (e) {}
      return;
    }
    const prev = (currentIndex - 1 + songs.length) % songs.length;
    setCurrentIndex(prev);
    try { await TrackPlayer.skip(prev); await TrackPlayer.play(); } catch (e) {}
  }, [songs, currentIndex, position]);

  const seekTo = useCallback(async (seconds) => {
    try { await TrackPlayer.seekTo(seconds); } catch (e) {}
  }, []);

  const shufflePlay = useCallback((songList) => {
    if (!songList.length) return;
    const shuffled = [...songList].sort(() => Math.random() - 0.5);
    setShuffle(true);
    playSong(shuffled, 0);
  }, [playSong]);

  // Jump straight to any song in the current playlist by index — used by
  // the Up Next queue so the user can tap a played song to go back to it,
  // or tap ahead, without losing the rest of the playlist.
  const playAtIndex = useCallback(async (idx) => {
    await abortCrossfade();
    if (idx < 0 || idx >= songs.length || idx === currentIndex) return;
    setCurrentIndex(idx);
    try { await TrackPlayer.skip(idx); await TrackPlayer.play(); } catch (e) {}
  }, [songs, currentIndex]);

  // Wire OS RemoteNext/RemotePrevious to our skip logic so the queue is
  // honored from the notification / lock-screen too.
  useTrackPlayerEvents([Event.RemoteNext, Event.RemotePrevious], (event) => {
    if (event.type === Event.RemoteNext) skipNext();
    if (event.type === Event.RemotePrevious) skipPrev();
  });

  // Stable handler refs so memoised consumers (the Up Next list in
  // NowPlaying) don't invalidate every render.
  const removeFromQueue = useCallback(
    (index) => setQueue((q) => q.filter((_, i) => i !== index)),
    []
  );
  const playFromQueue = useCallback((index) => {
    setQueue((q) => {
      const song = q[index];
      if (song) playSong([song], 0);
      return q.filter((_, i) => i !== index);
    });
  }, [playSong]);

  const value = {
    songs, currentSong, currentIndex, isPlaying, position, duration,
    shuffle, repeat, queue,
    playSong, shufflePlay, playAtIndex, togglePlayPause, skipNext, skipPrev, seekTo,
    toggleShuffle: () => setShuffle((s) => !s),
    toggleRepeat: () => setRepeat((r) => (r + 1) % 3),
    addToQueue: (song) => setQueue((q) => [...q, song]),
    playNext: (song) => setQueue((q) => [song, ...q]),
    removeFromQueue, playFromQueue,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
