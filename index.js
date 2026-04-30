import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';

import App from './App';

// Register the playback service so the OS can call into it from the
// notification / lock-screen / Bluetooth controls even when the app is
// backgrounded or killed.
TrackPlayer.registerPlaybackService(() => require('./service'));

registerRootComponent(App);
