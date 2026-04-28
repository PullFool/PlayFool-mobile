// Mirrors the desktop PlayFool theme so the mobile app feels identical.
// Both palettes are exported; the active one is provided via ThemeContext.
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const darkPalette = {
  mode: 'dark',
  bgPrimary: '#121212',
  bgSecondary: '#1a1a1a',
  bgSurface: '#282828',
  bgHover: '#2a2a2a',
  bgCard: '#181818',
  green: '#1DB954',
  greenHover: '#1ed760',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textMuted: '#6a6a6a',
  border: '#333',
  red: '#ff4b6e',
};

export const lightPalette = {
  mode: 'light',
  bgPrimary: '#f5f5f5',
  bgSecondary: '#ffffff',
  bgSurface: '#e8e8e8',
  bgHover: '#dddddd',
  bgCard: '#f0f0f0',
  green: '#1DB954',
  greenHover: '#1aa34a',
  textPrimary: '#1a1a1a',
  textSecondary: '#555555',
  textMuted: '#999999',
  border: '#dddddd',
  red: '#ff4b6e',
};

// Backwards-compatibility export so files that imported `theme` keep compiling.
// They'll get the dark palette — once they migrate to useTheme() they react to changes.
export const theme = darkPalette;

const THEME_KEY = 'playfool_mobile_theme';
const ThemeContext = createContext({ theme: darkPalette, mode: 'dark', toggle: () => {} });

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === 'light' || v === 'dark') setMode(v);
    });
  }, []);

  const toggle = async () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    try { await AsyncStorage.setItem(THEME_KEY, next); } catch (e) {}
  };

  const palette = mode === 'dark' ? darkPalette : lightPalette;

  return (
    <ThemeContext.Provider value={{ theme: palette, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
