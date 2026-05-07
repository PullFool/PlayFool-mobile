import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { PlayerProvider } from './src/context/PlayerContext';
import Player from './src/components/Player';
import NowPlaying from './src/screens/NowPlaying';
import UpdateBanner from './src/components/UpdateBanner';
import HeartPrompt from './src/components/HeartPrompt';
import HiddenYouTubeWebView from './src/components/HiddenYouTubeWebView';
import { installErrorReporter } from './src/utils/errorReporter';
import { ThemeProvider } from './src/utils/theme';
import { restoreEq } from './src/utils/eq';

installErrorReporter();
import MyMusic from './src/screens/MyMusic';
import YouTube from './src/screens/YouTube';
import Playlists from './src/screens/Playlists';
import Settings from './src/screens/Settings';
import { theme } from './src/utils/theme';

const Tab = createBottomTabNavigator();

const navTheme = {
  dark: true,
  colors: {
    primary: theme.green,
    background: theme.bgPrimary,
    card: theme.bgSecondary,
    text: theme.textPrimary,
    border: theme.border,
    notification: theme.green,
  },
};

const screenOptions = ({ route }) => ({
  headerShown: false,
  tabBarActiveTintColor: theme.green,
  tabBarInactiveTintColor: theme.textMuted,
  tabBarStyle: {
    backgroundColor: theme.bgSecondary,
    borderTopColor: theme.border,
  },
  tabBarIcon: ({ color, size }) => {
    const map = {
      'My Music': 'home',
      'YouTube': 'logo-youtube',
      'Playlists': 'list',
      'Settings': 'settings',
    };
    return <Ionicons name={map[route.name] || 'help'} size={size} color={color} />;
  },
});

function AppShell() {
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  useEffect(() => { restoreEq(); }, []);
  return (
    <>
      <SafeAreaView style={styles.root} edges={['top']}>
        <UpdateBanner />
        <NavigationContainer theme={navTheme}>
          <View style={{ flex: 1 }}>
            <Tab.Navigator screenOptions={screenOptions}>
              <Tab.Screen name="My Music" component={MyMusic} />
              <Tab.Screen name="YouTube" component={YouTube} />
              <Tab.Screen name="Playlists" component={Playlists} />
              <Tab.Screen name="Settings" component={Settings} />
            </Tab.Navigator>
            <Player onExpand={() => setShowNowPlaying(true)} />
          </View>
        </NavigationContainer>
      </SafeAreaView>
      <NowPlaying visible={showNowPlaying} onClose={() => setShowNowPlaying(false)} />
      <HeartPrompt />
      <HiddenYouTubeWebView />
      <StatusBar style="light" backgroundColor={theme.bgPrimary} />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PlayerProvider>
          <AppShell />
        </PlayerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bgPrimary },
});
