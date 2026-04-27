// In-app YouTube extractor using youtubei.js — no backend needed.
// Audio-only on mobile (no MP4, no merging — phones can't run ffmpeg).
import { Innertube } from 'youtubei.js';
import * as FileSystem from 'expo-file-system';

let yt = null;
async function getYt() {
  if (!yt) yt = await Innertube.create({ retrieve_player: false });
  return yt;
}

const fmtDuration = (seconds) => {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export async function searchMusic(query, limit = 30) {
  const client = await getYt();
  const results = await client.search(query, { type: 'video' });
  const videos = (results.videos || []).slice(0, limit);
  return videos.map(v => ({
    id: v.id,
    title: v.title?.text || v.title || 'Unknown',
    channel: v.author?.name || v.channel?.name || 'YouTube',
    duration: fmtDuration(v.duration?.seconds || 0),
    thumbnail: v.thumbnails?.[0]?.url || v.best_thumbnail?.url || null,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  }));
}

// Get a direct audio stream URL the phone can play with expo-av
export async function getAudioStreamUrl(videoId) {
  const client = await getYt();
  const info = await client.getBasicInfo(videoId);
  // Pick best audio-only format
  const audio = info.chooseFormat({ type: 'audio', quality: 'best' });
  if (!audio) throw new Error('No audio stream found');
  return audio.decipher(client.session.player);
}

// Download audio to phone's PlayFool music folder
const sanitize = (name) => (name || 'audio').replace(/[<>:"/\\|?*]+/g, '').slice(0, 120);

export async function downloadAudio(video, onProgress) {
  const url = await getAudioStreamUrl(video.id);
  const dir = FileSystem.documentDirectory + 'PlayFool/';
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const filename = `${sanitize(video.title)}.m4a`;
  const target = dir + filename;

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    target,
    {},
    (snapshot) => {
      if (onProgress && snapshot.totalBytesExpectedToWrite > 0) {
        const pct = Math.round(
          (snapshot.totalBytesWritten / snapshot.totalBytesExpectedToWrite) * 100
        );
        onProgress(pct);
      }
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');
  return { uri: result.uri, filename, title: video.title };
}

// List previously downloaded audio files in PlayFool folder
export async function listLocalAudio() {
  const dir = FileSystem.documentDirectory + 'PlayFool/';
  const exists = await FileSystem.getInfoAsync(dir);
  if (!exists.exists) return [];
  const files = await FileSystem.readDirectoryAsync(dir);
  const audio = files.filter(f => /\.(m4a|mp3|webm|opus|ogg)$/i.test(f));
  return audio.map(f => ({
    id: 'local-' + f,
    title: f.replace(/\.[^.]+$/, ''),
    artist: 'PlayFool',
    url: dir + f,
    cover: null,
    source: 'local',
  }));
}

export async function deleteLocalAudio(uri) {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
