# PlayFool Mobile (Android)

Companion mobile app for PlayFool desktop. Built with **Expo (React Native)**.

The phone is a **thin client** for your desktop PlayFool over LAN — your PC handles YouTube search, downloads, and stores the library; your phone plays it back.

## Getting started

```bash
cd PlayFool-mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your Android phone (install from Play Store) and the app loads instantly. No Android Studio needed.

## First-time setup

1. Make sure your **PC PlayFool desktop is running** and your phone is on the same Wi-Fi.
2. Find your PC's local IP:
   - Windows → `ipconfig` → look for `IPv4 Address` (e.g. `192.168.1.10`)
3. Open PlayFool mobile → **Settings** tab → enter `http://192.168.1.10:3001` (replace with your IP).
4. Tap **Test connection**. Should say "✓ Connected to your PC!"
5. Now **My Music**, **My Videos**, and **YouTube** all work.

## Build a real APK

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

This builds an `.apk` you can sideload onto any Android device.

## What's included

| Screen | Description |
|---|---|
| My Music | Your PC library, search, shuffle, play |
| My Videos | Your PC video library, search, play |
| YouTube | Search 30 results, MP3 / MP4 download triggers PC |
| Playlists | (placeholder — to come in next update) |
| Settings | PC IP/port config, Ko-fi support link |

## Notes

- Audio plays via `expo-av`, supports background playback on Android.
- The phone uses the **same backend API** as the desktop — no separate server is needed.
- yt-dlp / ffmpeg never run on the phone; everything happens on your PC.
