// Storage Access Framework — lets PlayFool own a real folder that survives
// uninstall AND skips Android's "Allow modify" prompts on every download
// and delete. The user picks the folder ONCE; we persist the URI and use
// it for all subsequent operations.
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAF_URI_KEY = 'playfool_saf_directory_uri';
const SAF = FileSystem.StorageAccessFramework;

export async function getSafUri() {
  try { return await AsyncStorage.getItem(SAF_URI_KEY); } catch (e) { return null; }
}

export async function clearSafUri() {
  try { await AsyncStorage.removeItem(SAF_URI_KEY); } catch (e) {}
}

// Show Android's folder picker. User picks a folder once (we suggest /Music/),
// then PlayFool gets persistent permission to read/write/delete inside that
// folder without any further system prompts.
export async function requestSafFolder() {
  if (!SAF || typeof SAF.requestDirectoryPermissionsAsync !== 'function') {
    throw new Error('SAF not available on this device');
  }
  const result = await SAF.requestDirectoryPermissionsAsync();
  if (!result.granted) throw new Error('Folder permission denied');
  await AsyncStorage.setItem(SAF_URI_KEY, result.directoryUri);
  return result.directoryUri;
}

// Write a file from cache into the SAF folder. Returns the SAF content:// URI.
export async function safCreateFile(safUri, fileName, mimeType, sourceCacheUri) {
  const fileUri = await SAF.createFileAsync(safUri, fileName, mimeType || 'audio/mpeg');
  // SAF's writeAsStringAsync accepts base64. Read source as base64, write to SAF.
  const base64 = await FileSystem.readAsStringAsync(sourceCacheUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

// List all files inside the SAF folder. Returns [{ uri, name, size }].
export async function safListFiles(safUri) {
  if (!safUri) return [];
  const uris = await SAF.readDirectoryAsync(safUri);
  const out = [];
  for (const uri of uris) {
    let name = '';
    let size = 0;
    try {
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      size = info?.size || 0;
    } catch (e) {}
    // Decode the filename from the content:// URI's last segment.
    try {
      const decoded = decodeURIComponent(uri);
      const match = decoded.match(/[^/:]+$/);
      name = match ? match[0] : '';
    } catch (e) { name = ''; }
    if (/\.(mp3|m4a|opus|webm|ogg|wav|aac|flac)$/i.test(name)) {
      out.push({ uri, name, size });
    }
  }
  return out;
}

// Silent delete — no Android system prompt because the file is in a
// SAF-granted folder, not MediaStore-owned.
export async function safDelete(uri) {
  if (!uri) return;
  await SAF.deleteAsync(uri);
}

// Convenience: ensure we have a folder URI, prompting the user if not.
export async function ensureSafFolder() {
  const existing = await getSafUri();
  if (existing) return existing;
  return requestSafFolder();
}
