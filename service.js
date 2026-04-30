// Background service for react-native-track-player. Wires the OS
// notification / lock-screen / Bluetooth controls to the player.
import TrackPlayer, { Event } from 'react-native-track-player';

module.exports = async function() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteJumpForward, async ({ interval }) => {
    const pos = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo((pos.position || 0) + (interval || 10));
  });
  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async ({ interval }) => {
    const pos = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, (pos.position || 0) - (interval || 10)));
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
    TrackPlayer.seekTo(position);
  });
};
