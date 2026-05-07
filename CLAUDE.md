# PlayFool Mobile

Android-only music player. Mirrors most desktop features: YouTube search/download, local playback, lock-screen controls, EQ, crossfade, lyrics, cloud sync with the desktop.

## Stack

- **Framework:** Expo SDK 51 (managed but with committed `android/` folder for native deps)
- **React Native:** 0.74.5
- **Pinned versions matter** — bumping individual Expo deps causes gradle errors. Always check Expo SDK 51 compatibility table before changing versions.
- **Audio engine:** react-native-track-player 4.x (lock-screen + notification + Bluetooth controls)
- **Storage:** expo-media-library + Storage Access Framework (SAF) via expo-file-system
- **Native EQ:** Custom Kotlin module wrapping `android.media.audiofx.Equalizer` (`android/app/src/main/java/com/pullfool/playfool/eq/`)
- **Crossfade:** JS-only via expo-av overlay (no native module)
- **CI:** GitHub Actions (`.github/workflows/build-android.yml`) — triggers on `v*` tag push, runs `./gradlew assembleRelease`, uploads APK to GitHub release

## Commands

- Dev: `expo start`
- Production APK locally: `expo run:android` (rare; CI handles releases)
- No `npm test` configured

## Release flow

1. Bump `version` in `app.json`
2. Local commit
3. Tag `v1.0.X`
4. Push tag → CI builds APK
5. APK appears in GitHub release; users get `UpdateBanner` prompt in-app

## Files that matter

- `src/utils/yt.js` — YouTube extraction (now phone-side via Innertube + API fallback) + listLocalAudio + delete + scan
- `src/utils/youtubeStream.js` — phone-side Innertube extraction (Android client)
- `src/utils/sync.js` — cloud sync with desktop via Cloudflare Worker
- `src/utils/saf.js` — Storage Access Framework wrapper (folder-pick, list, delete)
- `src/utils/eq.js` — JS bridge to native EQ module
- `src/utils/crossfade.js` — JS-only crossfade controller
- `src/utils/errorReporter.js` — Discord webhook reporter (uses `EXPO_PUBLIC_DISCORD_WEBHOOK` injected at build time via GitHub secret `DISCORD_WEBHOOK_MOBILE`)
- `src/screens/NowPlaying.js` — full-screen Now Playing with karaoke synced lyrics
- `src/screens/SyncScreen.js`, `EqScreen.js`, `MyMusic.js`, `YouTube.js`, `Settings.js`
- `android/` — committed prebuild; do NOT run `expo prebuild` (would regenerate and likely break)

## Conventions

- New downloads go to the SAF folder (user picks it on first download). Legacy MediaStore PlayFool album is read-only fallback.
- Filename sanitization across PC/phone/cloud must match the `songKey()` normalization in `sync.js` (strips ext + punctuation, lowercased) for dedup to work
- All Android system permission prompts should ideally be replaced with our own confirm dialogs first — Android's "modify audio" dialog can't be removed without SAF
- The committed `android/gradlew` needs the executable bit; CI workflow has `chmod +x` for safety

## Don't

- Run `expo prebuild` — overwrites the committed `android/` and breaks gradle config
- Add native deps without testing the gradle build (the camera package incident — see git log around v1.0.21–v1.0.23)
- Bump individual Expo packages without checking SDK 51 compatibility
- Use `MediaLibrary.addAssetsToAlbumAsync` — triggers Android prompts even with `copyAssets:true`. Use SAF instead.

## Deploy

GitHub Actions only. No app store distribution yet.

## Open issues / known limitations

- YouTube downloads reliability depends on YouTube's anti-bot — phone-side Innertube usually works (residential IP), Railway API is fallback that mostly fails right now
- Filename dedup is best-effort — songs with very different titles between PC and phone can still slip through as duplicates
