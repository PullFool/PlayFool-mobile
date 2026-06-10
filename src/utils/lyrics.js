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
    // Audio file extensions sneak through when a song object was cached by an
    // older build that didn't strip them in listLocalAudio / scanPhoneAudio.
    // Caught here defensively so parseArtistTitle and the variants below
    // never carry .mp3 into the lrclib query — that's how OPM tracks like
    // "Binibini - Brownman Revival.mp3" ended up with track="Brownman
    // Revival.mp3" and 404'd on every search before falling through to a
    // wrong NetEase namesake.
    .replace(/\.(mp3|m4a|opus|webm|ogg|wav|aac|flac)$/i, '')
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

// Reject lyrics that look like a Chinese cover/version when the query was
// in Latin script. NetEase indexes a lot of CJK songs that share a Western
// title — without this guard, "Binibini" returned a Chinese namesake's
// fully-CJK lyrics. Anything over ~30% CJK characters is treated as a
// language mismatch.
function isMostlyCJK(text) {
  if (!text) return false;
  const cjk = (text.match(/[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿가-힯]/g) || []).length;
  const meaningful = text.replace(/[\[\]\d:.\s\n]/g, '').length;
  return meaningful > 0 && cjk / meaningful > 0.3;
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

    // Return every top-3 candidate that has lyrics AND isn't mostly CJK,
    // so the user has "Try next" alternatives instead of being stuck with
    // a single wrong match.
    const out = [];
    for (const song of songs.slice(0, 3)) {
      const lyrics = await fetchNeteaseLyricsById(song.id);
      if (!lyrics) continue;
      if (isMostlyCJK(lyrics.synced)) continue;
      out.push({
        id: `netease-${song.id}`,
        name: song.name,
        artistName: (song.artists || []).map((a) => a.name).filter(Boolean).join(', '),
        syncedLyrics: lyrics.synced,
        plainLyrics: lyrics.plain,
        duration: song.duration ? Math.round(song.duration / 1000) : null,
      });
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

// Genius scraper — last-ditch fallback for OPM/niche tracks neither lrclib
// nor NetEase has indexed. Genius blocks bare requests; we have to pass a
// browser-shaped User-Agent or the search endpoint 403s. Genius doesn't
// expose lyrics through the API — we scrape them from the song page's
// data-lyrics-container divs. Plain text only (no synced timestamps).
const GENIUS_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function searchGenius(query) {
  try {
    const res = await fetch(
      `https://genius.com/api/search/multi?q=${encodeURIComponent(query)}&per_page=5`,
      { headers: GENIUS_HEADERS },
    );
    if (!res.ok) return [];
    const json = await res.json();
    const sections = json?.response?.sections || [];
    const songSection = sections.find((s) => s.type === 'song');
    return (songSection?.hits || []).map((h) => ({
      id: h.result.id,
      name: h.result.title,
      artist: h.result.primary_artist?.name || '',
      url: h.result.url,
    }));
  } catch (e) {
    return [];
  }
}

async function fetchGeniusLyricsByUrl(url) {
  try {
    const res = await fetch(url, { headers: GENIUS_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const re = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;
    const chunks = [];
    let m;
    while ((m = re.exec(html)) !== null) chunks.push(m[1]);
    if (chunks.length === 0) return null;
    const text = chunks.join('<br>')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

async function searchGeniusResults(title) {
  const hits = await searchGenius(title);
  if (!hits.length) return [];
  // Pull the top 3 hits in parallel so the user has "Try next" candidates
  // when the top match is wrong (Genius's first hit isn't always the OPM
  // original — sometimes it's a cover or sample).
  const top = hits.slice(0, 3);
  const lyricsByHit = await Promise.all(top.map((h) => fetchGeniusLyricsByUrl(h.url)));
  const out = [];
  for (let i = 0; i < top.length; i++) {
    if (!lyricsByHit[i]) continue;
    out.push({
      id: `genius-${top[i].id}`,
      name: top[i].name,
      artistName: top[i].artist,
      syncedLyrics: null,
      plainLyrics: lyricsByHit[i],
      duration: null,
    });
  }
  return out;
}

// Fetch lyrics for a song. Tries lrclib first (precise /api/get when the title
// parses to "Artist - Track", then fuzzy multi-variant /api/search), then
// NetEase Music, then Genius. Each fallback only fires when the previous one
// found nothing, so a typical lrclib-known song still resolves in one round
// trip. The function name is kept for backward compatibility.
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
  const cleaned = cleanTitle(title);
  if (cleaned) {
    const neteaseResults = await searchNetease(cleaned);
    if (neteaseResults.length > 0) return neteaseResults;
    const geniusResults = await searchGeniusResults(cleaned);
    if (geniusResults.length > 0) return geniusResults;
  }
  return [];
}
