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

// Walk the search variants the way the desktop app does — return the first
// variant that yields any lrclib results. Returns [] when nothing matches.
export async function fetchLrclibResults(title) {
  for (const query of getSearchVariants(title)) {
    const results = await searchLrclib(query);
    if (results) return results;
  }
  return [];
}
