// Lyrics matching for PlayFool mobile — a faithful port of the desktop
// app's lrclib logic (server.js cleanTitle + getSearchVariants). Songs whose
// filename isn't a clean "Artist - Title" used to return zero lyrics because
// the old splitter gave up without a " - " separator. This walks several
// query variants instead, exactly like the desktop does.

const LRCLIB_BASE = 'https://lrclib.net/api';

// Strip upload/YouTube junk so the title is closer to "Artist Song".
// Stronger than the desktop server.js cleanTitle — it also removes a
// trailing run of bare junk words ("Lyrics Video", "Official Video HD",
// the common typo "Lyrcs", etc.), which the parens-only desktop version
// misses. That gap was why e.g. "rivermaya - 214 Lyrcs video" found no
// lyrics: the junk polluted the lrclib query.
export function cleanTitle(title) {
  return String(title || '')
    .replace(/\([^)]*\)/g, '')        // anything in (parens): (Official Video), (HD), (Audio)
    .replace(/\[[^\]]*\]/g, '')       // anything in [brackets]
    .replace(/\|.*$/, '')             // everything after a pipe
    .replace(/\bft\.?\b|\bfeat\.?\b/gi, '')
    .replace(/Tower Sessions?/gi, '')
    // Trailing run of upload-junk words. Trailing-only, so a song actually
    // named "Video Games" keeps its leading word.
    .replace(/([\s\-–—|]+(official|lyrics?|lyric|lyrcs|video|audio|hd|hq|4k|mv|m\/v|visualizer|music)\b)+\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Build the list of lrclib search queries to try, best-guess first.
// Mirrors getSearchVariants() in the desktop server.js.
export function getSearchVariants(title) {
  const cleaned = cleanTitle(title);
  const variants = cleaned ? [cleaned] : [];

  // "Artist - Song" → also try without the dash, just the song, and
  // "artist song" — the desktop does the same.
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    variants.push(parts.join(' '));
    if (parts.length >= 2) {
      variants.push(parts[1].trim());
      variants.push(`${parts[0].trim()} ${parts[1].trim()}`);
    }
  }

  return [...new Set(variants.filter(Boolean))];
}

// Stable reject-list key — based on the cleaned title so it stays consistent
// whether or not the filename has an artist split.
export function lyricsKey(title) {
  return cleanTitle(title).toLowerCase();
}

// Parse a cleaned title into { artist, track } if it has an "Artist - Title"
// shape — used for the precise /api/get lookup.
export function parseArtistTitle(title) {
  const cleaned = cleanTitle(title);
  const idx = cleaned.indexOf(' - ');
  if (idx > 0) {
    const artist = cleaned.slice(0, idx).trim();
    const track = cleaned.slice(idx + 3).trim();
    if (artist && track) return { artist, track };
  }
  return null;
}

async function searchLrclib(query) {
  try {
    const res = await fetch(`${LRCLIB_BASE}/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;
    return results;
  } catch (e) {
    return null;
  }
}

// NetEase Music fallback — far stronger OPM / Asian coverage than lrclib.
// Unofficial API but widely used and stable for years. Headers matter — the
// endpoint will refuse requests without a NetEase-looking Referer.
const NETEASE_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://music.163.com',
  'User-Agent': 'Mozilla/5.0',
};

async function fetchNeteaseLyricsById(songId) {
  try {
    const res = await fetch(
      `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`,
      { headers: NETEASE_HEADERS },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const synced = json?.lrc?.lyric;
    if (!synced) return null;
    const plain = synced.replace(/\[\d+:\d+\.\d+\]/g, '').replace(/\n{2,}/g, '\n').trim() || null;
    return { synced, plain };
  } catch (e) {
    return null;
  }
}

async function searchNetease(query) {
  try {
    const res = await fetch(
      `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&limit=5`,
      { headers: NETEASE_HEADERS },
    );
    if (!res.ok) return [];
    const json = await res.json();
    const songs = json?.result?.songs || [];
    if (songs.length === 0) return [];

    // Try top 3 results — the first match in NetEase isn't always the one
    // with usable lyrics (instrumentals, alt versions). Stop at the first
    // that returns a non-empty synced track.
    const out = [];
    for (const song of songs.slice(0, 3)) {
      const lyrics = await fetchNeteaseLyricsById(song.id);
      if (lyrics) {
        out.push({
          id: `netease-${song.id}`,
          name: song.name,
          artistName: (song.artists || []).map((a) => a.name).filter(Boolean).join(', '),
          syncedLyrics: lyrics.synced,
          plainLyrics: lyrics.plain,
          duration: song.duration ? Math.round(song.duration / 1000) : null,
        });
        break;
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

// Precise lookup — lrclib /api/get with an exact artist + track. Returns the
// single match or null. This is far more accurate than the fuzzy search,
// which returns *something* for almost any query.
async function getLrclib(artist, track) {
  try {
    const res = await fetch(
      `${LRCLIB_BASE}/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const one = await res.json();
    return (one && one.id) ? one : null;
  } catch (e) {
    return null;
  }
}

// Fetch lyrics for a song. Tries lrclib first (precise /api/get when the title
// parses to "Artist - Track", then fuzzy multi-variant /api/search), then falls
// back to NetEase Music for the songs lrclib doesn't have — OPM and Asian
// tracks especially. The function name is kept for backward compatibility.
export async function fetchLrclibResults(title) {
  const at = parseArtistTitle(title);
  if (at) {
    const exact = await getLrclib(at.artist, at.track);
    if (exact) return [exact];
  }
  for (const query of getSearchVariants(title)) {
    const results = await searchLrclib(query);
    if (results) return results;
  }
  // NetEase fallback — only reached when lrclib found nothing across all
  // search variants. We use the cleaned title because NetEase's fuzzy match
  // handles spaces / casing well.
  const cleaned = cleanTitle(title);
  if (cleaned) {
    const neteaseResults = await searchNetease(cleaned);
    if (neteaseResults.length > 0) return neteaseResults;
  }
  return [];
}
