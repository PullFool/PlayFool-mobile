// Playlist storage — pure AsyncStorage. Each playlist is { id, name, songs: [songObj] }.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'playfool_mobile_playlists';

export async function loadPlaylists() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function save(list) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function createPlaylist(name) {
  const list = await loadPlaylists();
  const playlist = {
    id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: name || 'New playlist',
    songs: [],
    createdAt: Date.now(),
  };
  list.unshift(playlist);
  await save(list);
  return playlist;
}

export async function renamePlaylist(id, name) {
  const list = await loadPlaylists();
  const next = list.map((p) => (p.id === id ? { ...p, name } : p));
  await save(next);
  return next;
}

export async function deletePlaylist(id) {
  const list = await loadPlaylists();
  const next = list.filter((p) => p.id !== id);
  await save(next);
  return next;
}

export async function addSongToPlaylist(playlistId, song) {
  const list = await loadPlaylists();
  const next = list.map((p) => {
    if (p.id !== playlistId) return p;
    if (p.songs.some((s) => s.url === song.url)) return p; // dedup
    return { ...p, songs: [...p.songs, song] };
  });
  await save(next);
  return next;
}

export async function removeSongFromPlaylist(playlistId, songUrl) {
  const list = await loadPlaylists();
  const next = list.map((p) =>
    p.id !== playlistId ? p : { ...p, songs: p.songs.filter((s) => s.url !== songUrl) }
  );
  await save(next);
  return next;
}
