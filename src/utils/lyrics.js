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
  // Take the top hit only — fetching every hit's full page is expensive and
  // most of the time the top match is right.
  const top = hits[0];
  const lyrics = await fetchGeniusLyricsByUrl(top.url);
  if (!lyrics) return [];
  return [{
    id: `genius-${top.id}`,
    name: top.name,
    artistName: top.artist,
    syncedLyrics: null,
    plainLyrics: lyrics,
    duration: null,
  }];
}

// Temporary diagnostic — v1.0.71 only. Posts a step-by-step trace of the
// lyrics fetch to the build-time Discord webhook so we can see WHY some
// songs that resolve fine on lrclib in a browser come back empty on the
// phone. To be stripped once the root cause is identified.
async function postLyricsTrace(title, steps) {
  const webhook = process.env.EXPO_PUBLIC_DISCORD_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PlayFool Lyrics Trace',
        embeds: [{
          title: `Trace: ${String(title || '(no title)').slice(0, 240)}`,
          color: 3447003,
          fields: steps.slice(0, 24).map((s) => ({
            name: String(s.label).slice(0, 200),
            value: String(s.value == null ? '(null)' : s.value).slice(0, 1000) || '(empty)',
            inline: false,
          })),
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch (e) {}
}

// Fetch lyrics for a song. Tries lrclib first (precise /api/get when the title
// parses to "Artist - Track", then fuzzy multi-variant /api/search), then
// NetEase Music, then Genius. Each fallback only fires when the previous one
// found nothing, so a typical lrclib-known song still resolves in one round
// trip. The function name is kept for backward compatibility.
export async function fetchLrclibResults(title) {
  const steps = [{ label: 'input title', value: title }];
  const cleaned = cleanTitle(title);
  steps.push({ label: 'cleanTitle()', value: cleaned });

  const at = parseArtistTitle(title);
  steps.push({
    label: 'parseArtistTitle()',
    value: at ? `artist="${at.artist}"  track="${at.track}"` : 'null (no " - " in cleaned title)',
  });

  if (at) {
    const url = `${LRCLIB_BASE}/get?artist_name=${encodeURIComponent(at.artist)}&track_name=${encodeURIComponent(at.track)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const one = await res.json();
        if (one && one.id) {
          steps.push({ label: 'lrclib precise', value: `HTTP 200 — HIT id=${one.id} synced=${!!one.syncedLyrics} plain=${!!one.plainLyrics}` });
          postLyricsTrace(title, steps);
          return [one];
        }
        steps.push({ label: 'lrclib precise', value: `HTTP 200 — body had no id` });
      } else {
        steps.push({ label: 'lrclib precise', value: `HTTP ${res.status}` });
      }
    } catch (e) {
      steps.push({ label: 'lrclib precise', value: `THROWN: ${e?.message || String(e)}` });
    }
  }

  const variants = getSearchVariants(title);
  steps.push({ label: 'variants', value: variants.join(' | ') || '(none)' });

  for (const query of variants) {
    const url = `${LRCLIB_BASE}/search?q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const results = await res.json();
        const n = Array.isArray(results) ? results.length : -1;
        if (n > 0) {
          steps.push({
            label: `fuzzy "${query}"`,
            value: `HTTP 200 — ${n} results, top='${results[0].name}' by '${results[0].artistName}' synced=${!!results[0].syncedLyrics}`,
          });
          postLyricsTrace(title, steps);
          return results;
        }
        steps.push({ label: `fuzzy "${query}"`, value: `HTTP 200 — ${n} results` });
      } else {
        steps.push({ label: `fuzzy "${query}"`, value: `HTTP ${res.status}` });
      }
    } catch (e) {
      steps.push({ label: `fuzzy "${query}"`, value: `THROWN: ${e?.message || String(e)}` });
    }
  }

  if (cleaned) {
    try {
      const neteaseResults = await searchNetease(cleaned);
      steps.push({ label: 'netease', value: `${neteaseResults.length} results` });
      if (neteaseResults.length > 0) {
        postLyricsTrace(title, steps);
        return neteaseResults;
      }
    } catch (e) {
      steps.push({ label: 'netease', value: `THROWN: ${e?.message || String(e)}` });
    }
    try {
      const geniusResults = await searchGeniusResults(cleaned);
      steps.push({ label: 'genius', value: `${geniusResults.length} results` });
      if (geniusResults.length > 0) {
        postLyricsTrace(title, steps);
        return geniusResults;
      }
    } catch (e) {
      steps.push({ label: 'genius', value: `THROWN: ${e?.message || String(e)}` });
    }
  }

  steps.push({ label: 'FINAL', value: 'returned []' });
  postLyricsTrace(title, steps);
  return [];
}
