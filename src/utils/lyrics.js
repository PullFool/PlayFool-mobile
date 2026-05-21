// Lyrics matching for PlayFool mobile — a faithful port of the desktop
// app's lrclib logic (server.js cleanTitle + getSearchVariants). Songs whose
// filename isn't a clean "Artist - Title" used to return zero lyrics because
// the old splitter gave up without a " - " separator. This walks several
// query variants instead, exactly like the desktop does.

const LRCLIB_BASE = 'https://lrclib.net/api';

// Strip upload/YouTube junk so the title is closer to "Artist Song".
// Mirrors cleanTitle() in the desktop server.js.
export function cleanTitle(title) {
  return String(title || '')
    .replace(/\(official\s*(music\s*)?video\)/gi, '')
    .replace(/\(official\s*lyric\s*video\)/gi, '')
    .replace(/\(live\s*(performance|at|session).*?\)/gi, '')
    .replace(/\(lyrics?\)/gi, '')
    .replace(/\(audio\)/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\|.*$/, '')
    .replace(/ft\.?|feat\.?/gi, '')
    .replace(/MV|M\/V|Music Video/gi, '')
    .replace(/Tower Sessions?/gi, '')
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
