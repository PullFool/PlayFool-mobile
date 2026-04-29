// Auto-updater for PlayFool mobile.
// Checks GitHub releases, downloads the new APK, and launches the Android installer.
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

const GITHUB_REPO = 'PullFool/PlayFool-mobile';

// Compare semantic versions like '1.0.18' > '1.0.17'.
export function isNewer(a, b) {
  const A = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const B = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// Check GitHub for a newer release. Returns { version, downloadUrl, fileName, releaseUrl } or null.
export async function checkForUpdate() {
  const current = Application.nativeApplicationVersion || 'dev';
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const latest = (data.tag_name || '').replace(/^v/, '');
  if (!latest || latest === current || !isNewer(latest, current)) return null;

  const apk = (data.assets || []).find((a) => a.name?.toLowerCase().endsWith('.apk'));
  if (!apk) return null;
  return {
    version: latest,
    downloadUrl: apk.browser_download_url,
    fileName: apk.name,
    releaseUrl: data.html_url,
  };
}

// Download the APK to app cache and report progress to the callback.
export async function downloadApk(downloadUrl, fileName, onProgress) {
  const target = FileSystem.cacheDirectory + (fileName || 'PlayFool.apk');
  // Clear any previous APK so it doesn't accumulate
  try { await FileSystem.deleteAsync(target, { idempotent: true }); } catch (e) {}

  const dl = FileSystem.createDownloadResumable(
    downloadUrl,
    target,
    {},
    (snap) => {
      if (onProgress && snap.totalBytesExpectedToWrite > 0) {
        const pct = Math.round((snap.totalBytesWritten / snap.totalBytesExpectedToWrite) * 100);
        onProgress(pct);
      }
    }
  );
  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('APK download failed');
  return result.uri;
}

// Hand the downloaded APK to Android's package installer. The user still has to
// tap 'Install' once because Android requires that for sideloaded APKs.
export async function installApk(localUri) {
  // Convert file:// to a content:// URI other apps can read
  const contentUri = await FileSystem.getContentUriAsync(localUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
