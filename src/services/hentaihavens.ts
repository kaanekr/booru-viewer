import type { BooruPost, BooruSource, BooruTagSuggestion, HentaiHavenFeedSection, TagCategory } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * HentaiHaven (https://hentaihaven.xxx / https://api.hentaihaven.app/v1) integration.
 * - Primary: official mobile REST API in Haniversity/hhaven style (api.hentaihaven.app/v1).
 *   /warden token auth, /hentai/all, /hentai/home, /search?q=...,
 *   /genre/all, /genre/{id}, /hentai/{id}.
 *   Episode stream URLs (m3u8) come directly in the `chapter_content` field.
 * - Secondary / Fallback: SSR HTML parsing (safety net on Cloudflare or network errors).
 * No React import - can be tested directly with node.
 *
 * API behavior notes (verified live):
 * - `search?q=` matches titles on a single word, there is NO pagination (`&p`
 *   is ignored, always returns the same list). A multi-word query is a PHRASE
 *   search: "school girl" or "big breasts" returns 0 results.
 * - `genre/all` is NOT the full genre list (e.g. Yuri/Tentacle/Uncensored missing);
 *   missing ones are completed with HENTAIHAVEN_KNOWN_GENRES.
 * - `hentai/home` sections (last/trending_month/yuri/ecchi/incest/tentacle/
 *   uncensored/last_episodes) have 20 items each, no pagination.
 */

export const HENTAIHAVEN_BASE = 'https://hentaihaven.xxx';
export const HENTAIHAVEN_API_BASE = 'https://api.hentaihaven.app/v1';

export const HENTAIHAVEN_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
export const HENTAIHAVEN_APP_UA = 'HH_xxx_APP';

const WARDEN_BODY =
  'sdkInt=33&board=goldfish_x86_64&brand=google&display=sdk_gphone_x86_64-userdebug+13+TE1A.220922.028+10190541+dev-keys&fingerprint=google%2Fsdk_gphone_x86_64%2Femu64xa%3A13%2FTE1A.220922.028%2F10190541%3Auserdebug%2Fdev-keys&manufacturer=Google&model=sdk_gphone_x86_64';

let cachedWardenToken: string | null = null;
let wardenPromise: Promise<string> | null = null;

/**
 * Fetches a warden token for the Cloudflare-protected Hentai Haven API.
 * Token stays valid for months; concurrent requests are coalesced into a single query (single-flight).
 */
export async function getHentaiHavenToken(forceRefresh: boolean = false): Promise<string> {
  if (cachedWardenToken && !forceRefresh) return cachedWardenToken;
  if (wardenPromise) return wardenPromise;

  wardenPromise = (async () => {
    try {
      const res = await fetch(`${HENTAIHAVEN_API_BASE}/warden`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'User-Agent': HENTAIHAVEN_APP_UA,
        },
        body: WARDEN_BODY,
      });

      if (!res.ok) {
        throw new Error(`Could not obtain warden token (HTTP ${res.status})`);
      }

      const json = await res.json();
      const token = json?.data?.token;
      if (!token || typeof token !== 'string') {
        throw new Error('No valid token found in warden response');
      }

      cachedWardenToken = token;
      return token;
    } finally {
      wardenPromise = null;
    }
  })();

  return wardenPromise;
}

/**
 * Sends an official v1 API request. On 401 or 502, refreshes the token
 * and retries once.
 */
export async function fetchHentaiHavenApi<T = any>(
  path: string,
  options: RequestInit = {},
  ms: number = 15000,
  signal?: AbortSignal
): Promise<T> {
  let token = await getHentaiHavenToken();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  const makeReq = async (tok: string) => {
    return await fetch(`${HENTAIHAVEN_API_BASE}/${path}`, {
      ...options,
      headers: {
        'User-Agent': HENTAIHAVEN_APP_UA,
        warden: tok,
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: ctrl.signal,
    });
  };

  try {
    let res = await makeReq(token);

    // If the token is invalid, clear it and refresh once
    if (res.status === 401 || res.status === 502) {
      token = await getHentaiHavenToken(true);
      res = await makeReq(token);
    }

    clearTimeout(timeout);

    if (res.status === 429) {
      throw new Error('HentaiHaven rate limit exceeded (429 Rate limit). Please wait a bit.');
    }
    if (!res.ok) {
      throw new Error(`HentaiHaven API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    return json?.data as T;
  } catch (e: any) {
    clearTimeout(timeout);
    throw e;
  }
}

/** 'School Girl' -> 'school-girl'; non-matching characters are dropped. */
export function hentaiHavenTagSlug(query: string | undefined): string {
  const slug = (query || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

export function buildHentaiHavenSearchCandidates(
  baseUrl: string,
  page: number,
  keyword: string
): string[] {
  const base = (baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');
  const k = (keyword || '').trim();
  if (!k) {
    if (page <= 1) return [base + '/browse/trending/'];
    return [base + '/browse/trending/page/' + page + '/'];
  }
  const slug = hentaiHavenTagSlug(k);
  if (!slug) return [];
  if (page <= 1) return [base + '/tag/' + slug + '/'];
  return [base + '/tag/' + slug + '/page/' + page + '/'];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, String.fromCharCode(39))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Converts a '681,000' / '1.3M' style view-count text into a number. */
export function parseHentaiHavenCount(raw: string | undefined): number {
  if (!raw) return 0;
  const clean = decodeEntities(raw).trim().replace(/,/g, '');
  const m = clean.match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return 0;
  const unit = (m[2] || '').toUpperCase();
  const mult = unit === 'K' ? 1000 : unit === 'M' ? 1000000 : unit === 'B' ? 1000000000 : 1;
  return Math.round(v * mult);
}

/**
 * Extracts series cards from listing HTML (home / trending / tag).
 */
export function parseHentaiHavenListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!html) return posts;
  const seen = new Set<string>();
  const base = (source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');

  const chunks = html.split('aspect-[2/3]');
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];

    const slugM = c.match(/href="\/watch\/([a-z0-9-]+)\/"/);
    if (!slugM) continue;
    const slug = slugM[1];
    if (seen.has(slug)) continue;

    const titleM =
      c.match(/<img[^>]*alt="([^"]+)"/i) || c.match(/aria-label="([^"]+)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';
    const posterM = c.match(/src="(https:\/\/img\.hentaihaven\.xxx\/[^"]+)"/);
    const poster = posterM ? posterM[1].trim() : '';
    if (!poster) continue;

    const viewsM = c.match(/aria-label="([\d,\.]+[KMB]?) views"/i);
    const views = viewsM ? parseHentaiHavenCount(viewsM[1]) : 0;

    seen.add(slug);
    posts.push({
      id: 'hh_' + slug,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: poster,
      previewVideoUrl: undefined,
      previewThumbUrl: undefined,
      previewThumbs: undefined,
      sampleUrl: poster,
      originalUrl: '',
      width: 600,
      height: 900,
      aspectRatio: 2 / 3,
      rating: 'e',
      score: views,
      favCount: views,
      tags: {
        artist: [],
        character: [],
        copyright: [],
        general: [],
        meta: ['video'],
      },
      allTags: [],
      sourceLink: base + '/watch/' + slug + '/',
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  return posts;
}

export interface HentaiHavenEpisode {
  ep: number;
  url: string;
  name?: string;
  streamUrl?: string;
  previewUrl?: string;
  thumbnail?: string;
  chapterId?: number;
}

/**
 * Extracts episodes from a series page (newest first).
 */
export function parseHentaiHavenEpisodes(html: string, seriesUrl: string): HentaiHavenEpisode[] {
  const eps: HentaiHavenEpisode[] = [];
  if (!html || !seriesUrl) return eps;
  const seriesM = seriesUrl.match(/\/watch\/([a-z0-9-]+)\//i);
  if (!seriesM) return eps;
  const prefix = '/watch/' + seriesM[1].toLowerCase() + '/episode-';
  const seen = new Set<string>();
  const re = /href="(\/watch\/[a-z0-9-]+\/episode-(\d+)\/)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href.toLowerCase().startsWith(prefix)) continue;
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    eps.push({ ep: parseInt(m[2], 10), url: href });
  }
  eps.sort((a, b) => b.ep - a.ep);
  return eps;
}

export interface HentaiHavenFiles {
  hls: string;
  mp4: string;
  thumb: string;
  durationSec?: number;
  episodes?: HentaiHavenEpisode[];
  tags?: BooruPost['tags'];
  allTags?: string[];
  views?: number;
  rating?: { rating: string | number; votes: number };
  description?: string;
}

/**
 * Cloudflare managed verification page detection.
 */
export function isChallengeHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return (
    html.includes('_cf_chl_opt') ||
    html.includes('challenge-error-text') ||
    html.includes('Enable JavaScript and cookies to continue')
  );
}

/** Normalizes escaped embedded URLs (\/, \u0026). */
function unescapeUrl(u: string): string {
  return u
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Extracts the playable file from episode detail HTML (fallback HTML path).
 */
export function parseHentaiHavenEpisodeDetail(html: string): HentaiHavenFiles {
  const out: HentaiHavenFiles = { hls: '', mp4: '', thumb: '' };
  if (!html) return out;

  const ldBlocks: string[] = [];
  const ldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = ldRe.exec(html)) !== null) ldBlocks.push(lm[1]);
  const scopes = ldBlocks.length > 0 ? ldBlocks : [html];
  for (const scope of scopes) {
    const hlsM = scope.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
    if (hlsM) {
      const url = unescapeUrl(hlsM[1]);
      if (/\.m3u8/i.test(url.split('?')[0])) {
        out.hls = url;
        break;
      }
      if (!out.mp4 && /\.mp4/i.test(url.split('?')[0])) out.mp4 = url;
    }
  }

  if (!out.hls) {
    const anyM = html.match(/https?:[^"'\s\\]*?\.m3u8[^"'\s\\]*/i);
    if (anyM) out.hls = unescapeUrl(anyM[0]);
  }

  if (!out.hls && !out.mp4) {
    const srcM =
      html.match(/<source[^>]+src="([^"]+\.mp4[^"]*)"/i) ||
      html.match(/<video[^>]+src="([^"]+\.mp4[^"]*)"/i) ||
      html.match(/file\s*:\s*"([^"]+\.mp4[^"]*)"/i);
    if (srcM) out.mp4 = unescapeUrl(decodeEntities(srcM[1]));
  }

  const scope0 = scopes.join('\n');
  const thM = scope0.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (!thM) {
    const thArrM = scope0.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i);
    if (thArrM) out.thumb = thArrM[1].trim();
  } else {
    out.thumb = thM[1].trim();
  }
  const durM = scope0.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i);
  if (durM && (durM[1] || durM[2] || durM[3])) {
    out.durationSec = (Number(durM[1]) || 0) * 3600 + (Number(durM[2]) || 0) * 60 + (Number(durM[3]) || 0);
  }
  return out;
}

// -------------------------------------------------------------
// GENRES / GENRE POOL (cache + static complement)
// -------------------------------------------------------------

interface HHGenreItem {
  term_id: number;
  name: string;
  slug: string;
  count: number;
  thumbnail?: string;
}

/**
 * Discover section keys (UI order). Genre sections come paged via
 * genre/{id}, trend/episode streams via hentai/home.
 */
export const HENTAIHAVEN_FEED_SECTIONS: { key: HentaiHavenFeedSection; label: string }[] = [
  { key: 'latest', label: 'Latest' },
  { key: 'trending', label: 'Trending' },
  { key: 'episodes', label: 'Latest Episodes' },
  { key: 'yuri', label: 'Yuri' },
  { key: 'ecchi', label: 'Ecchi' },
  { key: 'incest', label: 'Incest' },
  { key: 'tentacle', label: 'Tentacle' },
  { key: 'uncensored', label: 'Uncensored' },
];

/** Genre section -> official genre term_id (verified live). */
export const HENTAIHAVEN_SECTION_GENRE_IDS: Record<string, number> = {
  yuri: 102,
  ecchi: 2594,
  incest: 64,
  tentacle: 244,
  uncensored: 107,
};

/**
 * Core genres missing from the `genre/all` response (verified live with
 * total_results counts). The dynamic list takes priority; these only
 * fill in missing term_ids.
 */
const HENTAIHAVEN_KNOWN_GENRES: HHGenreItem[] = [
  { term_id: 102, name: 'Yuri', slug: 'yuri', count: 194 },
  { term_id: 244, name: 'Tentacle', slug: 'tentacle', count: 88 },
  { term_id: 107, name: 'Uncensored Hentai', slug: 'uncensored', count: 186 },
  { term_id: 106, name: 'Tsundere', slug: 'tsundere', count: 234 },
  { term_id: 66, name: 'Teen Hentai', slug: 'teen-hentai', count: 142 },
  { term_id: 67, name: 'Young Hentai', slug: 'young', count: 141 },
  { term_id: 104, name: 'Yaoi', slug: 'yaoi', count: 32 },
  { term_id: 2627, name: 'Softcore', slug: 'softcore', count: 48 },
  { term_id: 2605, name: 'Umemaro 3D', slug: 'umemaro-3d', count: 12 },
];

/**
 * HentaiHaven official studios / authors (red tags).
 * They arrive in post_authors in the API and their series are listed via
 * tag/{term_id} or genre/{term_id}.
 */
export const HENTAIHAVEN_KNOWN_AUTHORS: HHGenreItem[] = [
  { term_id: 167, name: 'Pink Pineapple', slug: 'pink-pineapple', count: 161 },
  { term_id: 231, name: 'MS Pictures', slug: 'ms-pictures', count: 87 },
  { term_id: 69, name: 'PoRO', slug: 'poro', count: 62 },
  { term_id: 301, name: 'Mary Jane', slug: 'mary-jane', count: 54 },
  { term_id: 472, name: 'Queen Bee', slug: 'queen-bee', count: 53 },
  { term_id: 1041, name: 'T-Rex', slug: 't-rex', count: 48 },
  { term_id: 2579, name: 'nur', slug: 'nur', count: 29 },
  { term_id: 864, name: 'Suzuki Mirano', slug: 'suzuki-mirano', count: 25 },
  { term_id: 2349, name: 'Majin Petit', slug: 'majin-petit', count: 23 },
  { term_id: 199, name: 'Bunnywalker', slug: 'bunnywalker', count: 22 },
  { term_id: 1714, name: 'Showten', slug: 'showten', count: 21 },
  { term_id: 262, name: 'Pixy Soft', slug: 'pixy-soft', count: 17 },
  { term_id: 923, name: 'Pashmina', slug: 'pashmina', count: 17 },
  { term_id: 209, name: 'Collaboration Works', slug: 'collaboration-works', count: 15 },
  { term_id: 1146, name: 'Lune Pictures', slug: 'lune-pictures', count: 15 },
  { term_id: 134, name: 'Magin Label', slug: 'magin-label', count: 13 },
  { term_id: 345, name: 'ZIZ', slug: 'ziz', count: 13 },
  { term_id: 223, name: 'Edge', slug: 'edge', count: 12 },
  { term_id: 275, name: 'SELFISH', slug: 'selfish', count: 11 },
  { term_id: 2447, name: 'GOLD BEAR', slug: 'gold-bear', count: 9 },
  { term_id: 1048, name: 'Bootleg', slug: 'bootleg', count: 7 },
  { term_id: 920, name: 'Studio 9 Maiami', slug: 'studio-9-maiami', count: 6 },
  { term_id: 2583, name: 'White Bear', slug: 'white-bear', count: 6 },
  { term_id: 2427, name: 'BOMB! CUTE! BOMB!', slug: 'bomb-cute-bomb', count: 6 },
  { term_id: 2620, name: 'King Bee', slug: 'king-bee', count: 5 },
  { term_id: 2592, name: 'Studio FOW', slug: 'studio-fow', count: 4 },
  { term_id: 2631, name: 'Seven', slug: 'seven', count: 3 },
  { term_id: 1711, name: 'Hokiboshi', slug: 'hokiboshi', count: 3 },
  { term_id: 2678, name: 'Suiseisha', slug: 'suiseisha', count: 3 },
  { term_id: 2243, name: 'Comic Media', slug: 'comic-media', count: 3 },
  { term_id: 2667, name: 'Rene Pictures', slug: 'rene-pictures', count: 1 },
  { term_id: 2611, name: 'POLLUX ANIMATION', slug: 'pollux-animation', count: 1 },
  { term_id: 2646, name: 'Sakura Purin', slug: 'sakura-purin', count: 1 },
];

/** Author/studio pool learned dynamically from post details */
const dynamicAuthorsMap = new Map<number, HHGenreItem>();

/** Caches an author from a post detail. */
export function registerHentaiHavenAuthor(author: { term_id?: number; name?: string; count?: number }): void {
  const termId = Number(author?.term_id);
  const name = (author?.name || '').trim();
  if (Number.isFinite(termId) && name) {
    if (!dynamicAuthorsMap.has(termId)) {
      dynamicAuthorsMap.set(termId, {
        term_id: termId,
        name,
        slug: hentaiHavenTagSlug(name),
        count: Number(author.count) || 0,
      });
    }
  }
}

let cachedGenres: HHGenreItem[] | null = null;
let genresPromise: Promise<HHGenreItem[]> | null = null;

async function getAllGenres(): Promise<HHGenreItem[]> {
  if (cachedGenres) return cachedGenres;
  if (genresPromise) return genresPromise;

  genresPromise = (async () => {
    let dynamic: HHGenreItem[] = [];
    try {
      const data = await fetchHentaiHavenApi<HHGenreItem[]>('genre/all', {}, 10000);
      if (Array.isArray(data)) dynamic = data;
    } catch {
      dynamic = [];
    } finally {
      genresPromise = null;
    }
    const seen = new Set(dynamic.map((g) => g.term_id));
    const merged = [...dynamic];
    for (const known of HENTAIHAVEN_KNOWN_GENRES) {
      if (!seen.has(known.term_id)) merged.push(known);
    }
    // Also add known studios and dynamically learned authors
    for (const author of HENTAIHAVEN_KNOWN_AUTHORS) {
      if (!seen.has(author.term_id)) {
        seen.add(author.term_id);
        merged.push(author);
      }
    }
    for (const author of dynamicAuthorsMap.values()) {
      if (!seen.has(author.term_id)) {
        seen.add(author.term_id);
        merged.push(author);
      }
    }
    cachedGenres = merged;
    return merged;
  })();

  return genresPromise;
}

/** Resets the genre cache for tests. */
export function clearHentaiHavenGenreCache(): void {
  cachedGenres = null;
  genresPromise = null;
  dynamicAuthorsMap.clear();
}

/**
 * Normalizes an HH tag falling from the info dialog into search into a qualified
 * `tag:...` or `artist:...` form like on other servers.
 * - category === 'artist' (red tag): `artist:"name"` or `artist:name`
 * - other categories: `tag:"name"` or `tag:name`
 * - if already prefixed (`tag:`, `artist:`, `genre:`): untouched
 */
export function hentaiHavenTagQuery(tag: string | undefined, category?: TagCategory): string {
  const t = (tag || '').trim();
  if (!t) return '';
  if (/^[a-z][a-z-]*:/i.test(t)) return t;
  const lower = t.toLowerCase();
  const prefix = category === 'artist' ? 'artist' : 'tag';
  return /\s/.test(lower) ? `${prefix}:"${lower}"` : `${prefix}:${lower}`;
}

/**
 * Official genre names (https://hentaihaven.xxx/genres/ + official API harvest, 61).
 * These genres are shown in a different color in the info dialog.
 */
export const HENTAIHAVEN_OFFICIAL_GENRE_NAMES: string[] = [
  'Incest Hentai', 'Rape', 'Teen Hentai', 'Young Hentai', 'Yuri', 'Romance',
  'Yaoi', 'Harem', 'Tsundere', 'Uncensored Hentai', 'BDSM', 'Furry', 'Milf',
  'Anal', 'Futanari', 'Tentacle', 'Beastiality', 'Monster', 'Hentai School',
  'Horror', '3D Hentai', 'BBW', 'Gender Bender Hentai', 'Ecchi', 'Umemaro 3D',
  'Softcore', 'FemBoy', 'Femdom', 'Ahegao', 'Creampie', 'Blow Job',
  'Censored', 'Big Boobs', 'School', 'Masturbation', 'Fantasy', 'Nudity',
  'Exhibitionism', 'Big Breasts', 'Blowjob', 'HD', 'Paizuri', 'Hentai',
  'Comedy', 'Corruption', 'Office lady', 'Ntr', 'Cheating', 'Big Tits',
  'Sex Toys', 'Schoolgirl', 'Mind break', 'Elf', 'Impregnation', 'Gyaru',
  'Teasing', 'Erotic Game', 'Group Sex', 'Monster girl', 'Threesome',
  'Housewife',
];

let officialGenreKeys: Set<string> | null = null;

/**
 * Whether a tag is an official HH genre (for info dialog coloring).
 * Space/dash insensitive and tolerant of the ' Hentai' affix: the cleaned
 * 'Incest' tag matches the official 'Incest Hentai' genre.
 */
export function isHentaiHavenOfficialGenre(name: string | undefined): boolean {
  if (!officialGenreKeys) {
    officialGenreKeys = new Set<string>();
    for (const g of HENTAIHAVEN_OFFICIAL_GENRE_NAMES) {
      const n = normHentaiHavenToken(g);
      officialGenreKeys.add(n);
      officialGenreKeys.add(n.replace(/\s+/g, ''));
      const base = stripHentaiAffix(n);
      if (base) {
        officialGenreKeys.add(base);
        officialGenreKeys.add(base.replace(/\s+/g, ''));
      }
    }
  }
  const n = normHentaiHavenToken(name);
  if (!n) return false;
  return officialGenreKeys.has(n) || officialGenreKeys.has(n.replace(/\s+/g, ''));
}

/** Resets the home cache for tests. */
export function clearHentaiHavenHomeCache(): void {
  homeCache = null;
}

/** 'School Girl' -> 'school girl'; separators collapse to a single space. */
function normHentaiHavenToken(s: string | undefined): string {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'Incest Hentai' -> 'incest', 'Hentai School' -> 'school' (both are tried). */
function stripHentaiAffix(n: string): string {
  return n
    .replace(/^hentai\s+/g, '')
    .replace(/\s+hentai$/g, '')
    .trim();
}

/**
 * Matches free text against a genre. Space/dash/underscore insensitive
 * ('school girl' -> 'Schoolgirl'), the ' Hentai' prefix/suffix may drop
 * ('incest' -> 'Incest Hentai', 'school' -> 'Hentai School').
 * With multiple candidates, exact match wins, then the genre with the higher count.
 */
export function findHentaiHavenGenre(
  genres: HHGenreItem[],
  token: string | undefined
): HHGenreItem | null {
  const n = normHentaiHavenToken(token);
  if (!n) return null;
  const compact = n.replace(/\s+/g, '');
  const scored: { g: HHGenreItem; rank: number }[] = [];
  for (const g of genres) {
    const gn = normHentaiHavenToken(g.name);
    const gs = normHentaiHavenToken(g.slug);
    if (
      n === gn ||
      n === gs ||
      compact === gn.replace(/\s+/g, '') ||
      compact === gs.replace(/\s+/g, '')
    ) {
      scored.push({ g, rank: 0 });
      continue;
    }
    const base = stripHentaiAffix(gn);
    if (base && (n === base || compact === base.replace(/\s+/g, ''))) {
      scored.push({ g, rank: 1 });
    }
  }
  scored.sort((a, b) => a.rank - b.rank || (b.g.count || 0) - (a.g.count || 0));
  return scored.length > 0 ? scored[0].g : null;
}

export interface HentaiHavenParsedQuery {
  include: string[];
  exclude: string[];
}

/**
 * Splits a spaced query into tokens. A quoted group stays a single token
 * (`"big breasts"`), a `-` prefix goes to excludes, booru prefixes like
 * `tag:`/`genre:` are stripped. At most 12 tokens are processed.
 */
export function parseHentaiHavenQuery(raw: string | undefined): HentaiHavenParsedQuery {
  const include: string[] = [];
  const exclude: string[] = [];
  const seenIn = new Set<string>();
  const seenEx = new Set<string>();
  const push = (tok: string, neg: boolean) => {
    let t = (tok || '').trim();
    if (!t) return;
    if (!neg && t.startsWith('-')) {
      neg = true;
      t = t.replace(/^-+/, '').trim();
    }
    t = t.replace(/^(tag|genre|artist|character|parody|group|language|category):/i, '').trim();
    // Quotes are stripped: tag:"big breasts" -> big breasts
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (neg) {
      if (!seenEx.has(key)) {
        seenEx.add(key);
        exclude.push(t);
      }
    } else {
      if (!seenIn.has(key)) {
        seenIn.add(key);
        include.push(t);
      }
    }
  };

  let rest = raw || '';
  // First -?"..." groups (e.g. -"big breasts" exclusion also works)
  rest = rest.replace(/(-?)"([^"]*)"/g, (_m, neg: string, inner: string) => {
    push((neg ? '-' : '') + inner, false);
    return ' ';
  });
  for (const part of rest.split(/\s+/)) {
    if (!part) continue;
    push(part, false);
    if (include.length + exclude.length >= 12) break;
  }
  return { include, exclude };
}

/**
 * HentaiHaven tag / genre / studio search and autocomplete.
 * The genre and studio pools (authors) are scanned; matching studios are suggested
 * with the 'artist' category (red badge), genres with 'general'.
 */
export async function searchHentaiHavenTags(
  query: string,
  limit: number = 12
): Promise<BooruTagSuggestion[]> {
  const q = normHentaiHavenToken(query);
  if (!q) return [];
  const qc = q.replace(/\s+/g, '');
  const terms = await getAllGenres();
  const authorIds = new Set([
    ...HENTAIHAVEN_KNOWN_AUTHORS.map((a) => a.term_id),
    ...dynamicAuthorsMap.keys(),
  ]);

  const matched = terms.filter((g) => {
    const name = normHentaiHavenToken(g.name);
    const slug = normHentaiHavenToken(g.slug);
    return (
      name.includes(q) ||
      slug.includes(q) ||
      name.replace(/\s+/g, '').includes(qc) ||
      slug.replace(/\s+/g, '').includes(qc)
    );
  });
  matched.sort((a, b) => (b.count || 0) - (a.count || 0));

  return matched.slice(0, limit).map((g) => ({
    name: g.name,
    category: (authorIds.has(g.term_id) ? 'artist' : 'general') as TagCategory,
    postCount: g.count,
  }));
}

// -------------------------------------------------------------
// API-BASED POST FETCHING (fetchHentaiHavenPosts)
// -------------------------------------------------------------

function mapApiItemToPost(item: any, source: BooruSource): BooruPost {
  const numericId = item.post_ID;
  const slug = item.post_name || String(numericId);
  const base = (source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');
  const poster = item.post_thumbnail || '';
  // The trend stream also provides view counts (hentai/all does not -> stays 0).
  const views = Number(item.post_views) || 0;

  return {
    id: 'hh_' + numericId,
    sourceId: source.id,
    sourceName: source.name,
    title: item.post_title || undefined,
    previewUrl: poster,
    previewVideoUrl: undefined,
    previewThumbUrl: undefined,
    previewThumbs: undefined,
    sampleUrl: poster,
    originalUrl: '',
    width: 600,
    height: 900,
    aspectRatio: 2 / 3,
    rating: 'e',
    score: views,
    favCount: views,
    tags: {
      artist: [],
      character: [],
      copyright: [],
      general: [],
      meta: ['video'],
    },
    allTags: [],
    sourceLink: `${base}/watch/${slug}/`,
    mediaId: String(numericId),
    fileExt: 'mp4',
    createdAt: item.post_date || new Date().toISOString(),
  };
}

/**
 * Converts a hentai/home `last_episodes` item into a series card. The episode cover
 * (chapter_thumbnail) becomes the preview, the card links to the series detail (post_ID).
 */
function mapApiEpisodeItemToPost(item: any, source: BooruSource): BooruPost | null {
  const numericId = Number(item.post_ID);
  if (!Number.isFinite(numericId)) return null;
  const slug = item.post_name || String(numericId);
  const base = (source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');
  const poster = item.chapter_thumbnail || item.post_thumbnail || '';
  if (!poster) return null;
  const epName = item.chapter_name || 'Episode';
  const title = item.post_title ? `${item.post_title} — ${epName}` : epName;

  return {
    id: 'hh_ep_' + (item.chapter_id ?? `${numericId}_${epName}`),
    sourceId: source.id,
    sourceName: source.name,
    title,
    previewUrl: poster,
    previewVideoUrl: undefined,
    previewThumbUrl: undefined,
    previewThumbs: undefined,
    sampleUrl: poster,
    originalUrl: '',
    width: 600,
    height: 900,
    aspectRatio: 2 / 3,
    rating: 'e',
    score: 0,
    favCount: 0,
    tags: {
      artist: [],
      character: [],
      copyright: [],
      general: [],
      meta: ['video'],
    },
    allTags: [],
    sourceLink: `${base}/watch/${slug}/`,
    mediaId: String(numericId),
    fileExt: 'mp4',
    createdAt: item.chapter_date || item.post_date || new Date().toISOString(),
  };
}

// -------------------------------------------------------------
// HOME / DISCOVER SECTIONS
// -------------------------------------------------------------

interface HentaiHavenHome {
  last?: any[];
  trending_month?: any[];
  last_episodes?: any[];
  yuri?: any[];
  ecchi?: any[];
  incest?: any[];
  tentacle?: any[];
  uncensored?: any[];
}

let homeCache: { at: number; data: HentaiHavenHome } | null = null;
const HOME_CACHE_TTL_MS = 60 * 1000;

/** Fetches hentai/home sections with a short-lived cache. */
export async function fetchHentaiHavenHome(): Promise<HentaiHavenHome> {
  const now = Date.now();
  if (homeCache && now - homeCache.at < HOME_CACHE_TTL_MS) return homeCache.data;
  const data = await fetchHentaiHavenApi<HentaiHavenHome>('hentai/home', {}, 12000);
  homeCache = { at: now, data: data || {} };
  return homeCache.data;
}

async function fetchGenreItems(termId: number, page: number): Promise<any[]> {
  try {
    const data = await fetchHentaiHavenApi<{ hentais: any[] }>(`genre/${termId}?p=${page}`);
    const list = Array.isArray(data?.hentais) ? data.hentais : [];
    return list;
  } catch {
    return [];
  }
}

/**
 * Single-word title search. `search` is single-page: if page > 1 is requested
 * it returns empty without hitting the network (the API ignores the `&p` parameter,
 * returns the same list; fetching pages again would produce duplicate cards).
 */
async function fetchSearchItems(query: string, page: number): Promise<any[]> {
  if (page > 1) return [];
  try {
    const data = await fetchHentaiHavenApi<any[]>(`search?q=${encodeURIComponent(query)}`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Single token: genre match first, title search otherwise. */
async function fetchSingleTokenItems(
  genres: HHGenreItem[],
  token: string,
  page: number
): Promise<any[]> {
  const matched = findHentaiHavenGenre(genres, token);
  if (matched) return fetchGenreItems(matched.term_id, page);
  return fetchSearchItems(token, page);
}

function postIdOf(item: any): number | null {
  const id = Number(item?.post_ID);
  return Number.isFinite(id) ? id : null;
}

/**
 * Multi-token query: each token is resolved separately (genre page or title
 * search), results are intersected over post_ID (AND logic).
 * If the intersection is empty, the UNION (OR) is returned — related content
 * instead of an empty screen.
 * Mixed (genre + title) queries cannot be paged: on page > 1 the title
 * search returns empty so the intersection would be meaningless, empty is
 * returned instead of the union (only paged AND works when all tokens are genres).
 */
async function fetchMultiTokenItems(
  genres: HHGenreItem[],
  tokens: string[],
  page: number
): Promise<any[]> {
  const limited = tokens.slice(0, 5);
  const lists: any[][] = [];
  let hasSearchToken = false;
  for (const t of limited) {
    const matched = findHentaiHavenGenre(genres, t);
    if (matched) {
      lists.push(await fetchGenreItems(matched.term_id, page));
    } else {
      hasSearchToken = true;
      lists.push(await fetchSearchItems(t, page));
    }
  }
  const nonEmpty = lists.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return [];
  // On page > 1 the title search already returned empty; intersecting
  // with the remaining genre pages would be wrong.
  if (page > 1 && hasSearchToken) return [];

  const hits = new Map<number, { item: any; count: number; firstSeen: number }>();
  let order = 0;
  lists.forEach((list) => {
    const seenInList = new Set<number>();
    for (const item of list) {
      const id = postIdOf(item);
      if (id === null || seenInList.has(id)) continue;
      seenInList.add(id);
      const prev = hits.get(id);
      if (prev) {
        prev.count += 1;
      } else {
        hits.set(id, { item, count: 1, firstSeen: order++ });
      }
    }
  });
  const total = lists.length;
  const all = [...hits.values()];
  const inter = all.filter((h) => h.count === total).sort((a, b) => a.firstSeen - b.firstSeen);
  if (inter.length > 0) return inter.map((h) => h.item);
  // If AND is empty, OR: most token matches first
  all.sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen);
  return all.map((h) => h.item);
}

/**
 * Applies title exclusions (`-token`) as a best-effort title-substring match
 * since list items carry no tags.
 */
function applyHentaiHavenExcludes(posts: BooruPost[], exclude: string[]): BooruPost[] {
  const norms = exclude
    .map((e) => normHentaiHavenToken(e).replace(/\s+/g, ''))
    .filter(Boolean);
  if (norms.length === 0) return posts;
  return posts.filter((p) => {
    const hay = normHentaiHavenToken(p.title || '').replace(/\s+/g, '');
    if (!hay) return true;
    return !norms.some((n) => hay.includes(n));
  });
}

/**
 * Discover stream: section key is routed to a paged source. Genre sections use
 * genre/{id}, trend/episode streams are single-page home sections.
 */
export async function fetchHentaiHavenFeedPosts(
  source: BooruSource,
  section: HentaiHavenFeedSection,
  page: number
): Promise<BooruPost[]> {
  if (section === 'trending' || section === 'episodes') {
    if (page > 1) return [];
    const home = await fetchHentaiHavenHome();
    if (section === 'trending') {
      const list = Array.isArray(home.trending_month) ? home.trending_month : [];
      return list.map((item) => mapApiItemToPost(item, source));
    }
    const list = Array.isArray(home.last_episodes) ? home.last_episodes : [];
    const posts: BooruPost[] = [];
    for (const item of list) {
      const mapped = mapApiEpisodeItemToPost(item, source);
      if (mapped) posts.push(mapped);
    }
    return posts;
  }
  if (section === 'latest') {
    const data = await fetchHentaiHavenApi<{ hentais: any[] }>(`hentai/all?p=${page}`);
    const list = Array.isArray(data?.hentais) ? data.hentais : [];
    return list.map((item) => mapApiItemToPost(item, source));
  }
  const termId = HENTAIHAVEN_SECTION_GENRE_IDS[section];
  if (termId) {
    const items = await fetchGenreItems(termId, page);
    return items.map((item) => mapApiItemToPost(item, source));
  }
  const data = await fetchHentaiHavenApi<{ hentais: any[] }>(`hentai/all?p=${page}`);
  const list = Array.isArray(data?.hentais) ? data.hentais : [];
  return list.map((item) => mapApiItemToPost(item, source));
}

/**
 * Lists Hentai Haven content via the official API.
 * - Empty query -> discover section (`section`: latest/trending/genres/episodes).
 *   Without a section it is derived from sort (score -> trend, else newest).
 * - Single token -> genre match (`genre/{id}`) or title search (`search?q=`).
 * - Multi token -> per-token resolution + post_ID intersection (AND), union if empty.
 * - `search` is single-page; on page > 1 title search returns empty.
 */
export async function fetchHentaiHavenPosts(
  source: BooruSource,
  page: number,
  tags: string = '',
  opts: { section?: HentaiHavenFeedSection | null; sortBy?: string } = {}
): Promise<BooruPost[]> {
  const { include, exclude } = parseHentaiHavenQuery(tags);

  try {
    // 1. Empty query -> discover section
    if (include.length === 0) {
      const section: HentaiHavenFeedSection =
        opts.section ?? (opts.sortBy === 'score' ? 'trending' : 'latest');
      return await fetchHentaiHavenFeedPosts(source, section, page);
    }

    const genres = await getAllGenres();

    // 1b. If the query matches a known genre or studio as a phrase (even written unquoted):
    // e.g. "Pink Pineapple", "Studio FOW", "Big Breasts", "Hentai School"
    // send the multi-word phrase directly to that term's page without splitting it!
    if (include.length > 1 && !tags.includes('"')) {
      const rawClean = tags
        .replace(/^(tag|genre|artist|character):"?/i, '')
        .replace(/"$/, '')
        .trim();
      const wholeMatch = findHentaiHavenGenre(genres, rawClean);
      if (wholeMatch) {
        const items = await fetchGenreItems(wholeMatch.term_id, page);
        return applyHentaiHavenExcludes(
          items.map((item) => mapApiItemToPost(item, source)),
          exclude
        );
      }
    }

    // 2. Single token -> genre or title search
    if (include.length === 1) {
      const items = await fetchSingleTokenItems(genres, include[0], page);
      return applyHentaiHavenExcludes(
        items.map((item) => mapApiItemToPost(item, source)),
        exclude
      );
    }

    // 3. Multi-token (spaced) search -> AND intersection / OR union
    const items = await fetchMultiTokenItems(genres, include, page);
    return applyHentaiHavenExcludes(
      items.map((item) => mapApiItemToPost(item, source)),
      exclude
    );
  } catch (apiErr: any) {
    console.warn('[HentaiHaven] API error, falling back to HTML:', apiErr?.message || apiErr);

    // 4. Safety net: HTML scraping fallback (with the first token)
    const fallbackQuery = include[0] || '';
    const candidates = buildHentaiHavenSearchCandidates(source.baseUrl || HENTAIHAVEN_BASE, page, fallbackQuery);
    if (candidates.length === 0) return [];
    const url = candidates[0];
    const headers = {
      'User-Agent': HENTAIHAVEN_UA,
      Referer: `${(source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '')}/`,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    };

    const res = await proxyService.fetchWithFallback(url, { headers }, 10000);
    if (!res.ok) return [];
    const html = await res.text();
    return parseHentaiHavenListing(html, source);
  }
}

// -------------------------------------------------------------
// EPISODE AND DETAIL RESOLUTION
// -------------------------------------------------------------

async function fetchHentaiHtml(
  url: string,
  ms: number,
  label: string,
  signal?: AbortSignal
): Promise<string | null> {
  const headers = {
    'User-Agent': HENTAIHAVEN_UA,
    Referer: HENTAIHAVEN_BASE + '/',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml',
  };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await proxyService.fetchWithFallback(url, { headers, signal: ctrl.signal }, ms);
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn('[HentaiHaven] HTTP ' + res.status + ' (' + label + ')');
      return null;
    }
    return await res.text();
  } catch (e: any) {
    clearTimeout(timeout);
    console.warn('[HentaiHaven] network error (' + label + '): ' + (e?.message || e));
    return null;
  }
}

/**
 * HentaiHaven SEO/spam and aggregator brand tag pool.
 * 40+ junk tags added to the site database for search engine ranking are removed.
 */
export const HENTAIHAVEN_SPAM_TAGS = new Set([
  // Aggregator and competitor brand names
  'e hentai',
  'ehentai',
  'ge hentai',
  'gehentai',
  'xanimeporn',
  'anime porn',
  'animeporn',
  'hanime tv',
  'hanimetv',
  'hanime',
  'hentai stream',
  'hentaistream',
  'mp4hentai',
  'hentaidude',
  'watch hentai',
  'watchhentai',
  'hentai foundry',
  'hentaifoundry',
  'hentai haven',
  'hentaihaven',
  'nhentai',
  'hentai chan',
  'hentaichan',
  'hentaicity',
  'hentai city',
  'gelbooru',
  'danbooru',
  'xhentai',
  'ohentai',
  'miohentai',
  'hentaicore',
  'hentaifreak',
  'kisshentai',
  'hentaiworld',
  'rule 34',
  'rule34',
  'pornhub',
  'xvideos',
  'xhamster',
  'spankbang',
  'redgifs',
  // Pure noise / non-distinctive generic words
  'hentai',
  'hentai porn',
  'hentaiporn',
  'hentai anime',
  'anime hentai',
  'hentai videos',
  'hentai video',
  'hentaivideos',
  'hentaivideo',
  'free hentai',
  'freehentai',
  'hentai manga',
  'hentai vid',
  'hentaivid',
  'hentai tv',
  'hentaitv',
  'hd',
  'sexy',
]);

/**
 * Checks whether a tag is a HentaiHaven spam/junk tag.
 */
export function isHentaiHavenSpamTag(tag: string | undefined): boolean {
  const norm = (tag || '').toLowerCase().trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  if (!norm || norm.length < 2) return true;
  if (HENTAIHAVEN_SPAM_TAGS.has(norm)) return true;

  // Generic pattern checks
  if (/^(watch|free|best|top|download)\s+hentai$/i.test(norm)) return true;
  if (/^hentai\s+(stream|tube|city|hub|world|haven|freak|core|chan|foundry|dude|video|videos|porn)$/i.test(norm)) return true;
  if (/^(kiss|mio|mp4|e|ge|x|o|n)\s*hentai/i.test(norm)) return true;

  return false;
}

/**
 * Cleans a HentaiHaven tag list of SEO junk and normalizes needless repetitions.
 * E.g.:
 * - 'eHentai', 'Gelbooru', 'Pornhub', 'Hentai' etc. are dropped entirely.
 * - 'Anal Hentai' -> 'Anal', 'Yuri Porn' -> 'Yuri', 'Teacher Hentai' -> 'Teacher'.
 * - Case-insensitive dedup is applied.
 */
export function cleanHentaiHavenTags(rawTags: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of rawTags) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (isHentaiHavenSpamTag(trimmed)) continue;

    let norm = trimmed;
    // Simplify redundant ' Hentai' / 'Hentai ' affixes except '3D Hentai'
    if (/\bhentai\b/i.test(norm) && norm.toLowerCase() !== '3d hentai') {
      const stripped = norm.replace(/\bhentai\b/gi, '').trim().replace(/\s+/g, ' ');
      if (stripped.length >= 3) {
        norm = stripped;
      }
    }
    // Simplify ' Porn' suffixes (e.g. 'Yuri Porn' -> 'Yuri')
    if (/\bporn\b/i.test(norm)) {
      const stripped = norm.replace(/\bporn\b/gi, '').trim().replace(/\s+/g, ' ');
      if (stripped.length >= 3) {
        norm = stripped;
      }
    }

    const key = norm.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(norm);
    }
  }

  return cleaned;
}

/**
 * Resolves the detail and episodes of a content item from its ID or slug via the API.
 */
export async function resolveHentaiHavenGalleryDetail(
  postRef: { mediaId?: string; id?: string; sourceLink?: string },
  signal?: AbortSignal
): Promise<{
  episodes: HentaiHavenEpisode[];
  tags: BooruPost['tags'];
  allTags: string[];
  views: number;
  rating?: { rating: string | number; votes: number };
  description?: string;
  title?: string;
  name?: string;
} | null> {
  let targetId: number | null = null;

  // 1. Derive from numeric mediaId or id
  if (postRef.mediaId && /^\d+$/.test(postRef.mediaId)) {
    targetId = parseInt(postRef.mediaId, 10);
  } else if (postRef.id && /^hh_(\d+)$/i.test(postRef.id)) {
    const m = postRef.id.match(/^hh_(\d+)$/i);
    if (m) targetId = parseInt(m[1], 10);
  }

  // 2. If no numeric id was found, find it via slug through API search.
  // Slug words are not searched as a single phrase (API phrase search is fragile);
  // a word-based AND intersection is used and the exact slug match is picked from it.
  if (!targetId && postRef.sourceLink) {
    const slugM = postRef.sourceLink.match(/\/watch\/([a-z0-9-]+)\//i);
    if (slugM) {
      const slug = slugM[1];
      try {
        const genres = await getAllGenres();
        const results = await fetchMultiTokenItems(genres, slug.split(/-/).filter(Boolean), 1);
        if (Array.isArray(results)) {
          const matched = results.find((r) => r.post_name === slug || r.post_ID === Number(slug));
          if (matched?.post_ID) targetId = matched.post_ID;
        }
      } catch {}
    }
  }

  if (!targetId) return null;

  try {
    const data = await fetchHentaiHavenApi<any>(`hentai/${targetId}`, {}, 12000, signal);
    if (!data || typeof data === 'string') return null;

    const rawEpisodes = Array.isArray(data.post_episodes) ? data.post_episodes : [];
    const episodes: HentaiHavenEpisode[] = rawEpisodes.map((ep: any, idx: number) => {
      const epNumMatch = (ep.chapter_name || ep.chapter_slug || '').match(/(\d+)/);
      const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : idx + 1;
      const streamUrl = ep.chapter_content || '';
      const previewUrl = ep.preview || '';
      const thumb = ep.chapter_thumbnail || ep.post_thumbnail || '';

      return {
        ep: epNum,
        url: streamUrl || `/watch/${data.post_name}/${ep.chapter_slug}/`,
        streamUrl,
        previewUrl,
        thumbnail: thumb,
        name: ep.chapter_name || `Episode ${epNum}`,
        chapterId: ep.chapter_id,
      };
    });

    // Newest episode first
    episodes.sort((a, b) => b.ep - a.ep);

    const rawGeneral: string[] = [];
    if (Array.isArray(data.post_genres)) {
      data.post_genres.forEach((g: any) => {
        if (g.name) rawGeneral.push(g.name);
      });
    }
    if (Array.isArray(data.post_tags)) {
      data.post_tags.forEach((t: any) => {
        if (t.name) rawGeneral.push(t.name);
      });
    }
    const generalTags = cleanHentaiHavenTags(rawGeneral);

    const artistTags: string[] = [];
    if (Array.isArray(data.post_authors)) {
      data.post_authors.forEach((a: any) => {
        if (a.name && !isHentaiHavenSpamTag(a.name)) {
          artistTags.push(a.name.trim());
          registerHentaiHavenAuthor(a);
        }
      });
    }

    const tags: BooruPost['tags'] = {
      artist: artistTags,
      character: [],
      copyright: [],
      general: generalTags,
      meta: ['video'],
    };
    const allTags = [...artistTags, ...generalTags];

    return {
      episodes,
      tags,
      allTags,
      views: Number(data.post_views) || 0,
      rating: data.post_rating,
      description: data.post_content || '',
      title: data.post_title,
      name: data.post_name,
    };
  } catch (err: any) {
    console.warn('[HentaiHaven] API detail resolve error:', err?.message || err);
    return null;
  }
}

/**
 * Episode list on the series page (newest first). For the EP selector in the viewer.
 */
export async function listHentaiHavenEpisodes(
  post: { sourceLink?: string; id?: string; mediaId?: string },
  signal?: AbortSignal
): Promise<HentaiHavenEpisode[]> {
  // 1. First the direct official API path
  const apiDetail = await resolveHentaiHavenGalleryDetail(post, signal);
  if (apiDetail && apiDetail.episodes.length > 0) {
    return apiDetail.episodes;
  }

  // 2. HTML scraping fallback
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return [];
  const html = await fetchHentaiHtml(post.sourceLink, 10000, 'seri', signal);
  if (!html || isChallengeHtml(html)) return [];
  return parseHentaiHavenEpisodes(html, post.sourceLink);
}

/**
 * Playable file from a single episode page or directly from a URL.
 */
export async function resolveHentaiHavenEpisodeUrl(
  episodeUrl: string,
  signal?: AbortSignal
): Promise<HentaiHavenFiles | null> {
  if (!episodeUrl) return null;

  // Return directly without a network call if a direct HLS or MP4 URL was given
  if (/\.m3u8/i.test(episodeUrl.split('?')[0])) {
    return { hls: episodeUrl, mp4: '', thumb: '' };
  }
  if (/\.mp4/i.test(episodeUrl.split('?')[0])) {
    return { hls: '', mp4: episodeUrl, thumb: '' };
  }

  if (!/^https?:\/\//i.test(episodeUrl)) return null;

  // HTML scraping fallback
  const html = await fetchHentaiHtml(episodeUrl, 10000, 'episode', signal);
  if (!html || isChallengeHtml(html)) return null;
  const files = parseHentaiHavenEpisodeDetail(html);
  if (!files.hls && !files.mp4) return null;
  return files;
}

/**
 * Resolves Series -> newest or preferred episode -> HLS stream.
 */
export async function resolveHentaiHavenEpisodeUrls(
  post: { sourceLink?: string; id?: string; mediaId?: string; previewUrl?: string },
  signal?: AbortSignal,
  preferredEp?: number | null
): Promise<HentaiHavenFiles | null> {
  // 1. First the official API path
  const detail = await resolveHentaiHavenGalleryDetail(post, signal);
  if (detail && detail.episodes.length > 0) {
    const episodes = detail.episodes;
    const targetEp =
      preferredEp != null
        ? episodes.find((e) => e.ep === preferredEp) || episodes[0]
        : episodes[0];

    const playableHls = targetEp.streamUrl || (targetEp.url.includes('.m3u8') ? targetEp.url : '');
    const playableMp4 = targetEp.previewUrl || (targetEp.url.includes('.mp4') ? targetEp.url : '');

    if (playableHls || playableMp4) {
      return {
        hls: playableHls,
        mp4: playableMp4,
        thumb: targetEp.thumbnail || post.previewUrl || '',
        episodes,
        tags: detail.tags,
        allTags: detail.allTags,
        views: detail.views,
        rating: detail.rating,
        description: detail.description,
      };
    }
  }

  // 2. HTML scraping fallback
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;

  const seriesHtml = await fetchHentaiHtml(post.sourceLink, 10000, 'seri', signal);
  if (!seriesHtml) return null;
  if (isChallengeHtml(seriesHtml)) {
    console.warn('[HentaiHaven] challenge wall (series)');
    return null;
  }
  const episodes = parseHentaiHavenEpisodes(seriesHtml, post.sourceLink);
  if (episodes.length === 0) {
    console.warn('[HentaiHaven] episode not found');
    return null;
  }
  const targetEp =
    preferredEp != null
      ? episodes.find((e) => e.ep === preferredEp) || episodes[0]
      : episodes[0];
  const baseM = post.sourceLink.match(/^https?:\/\/[^/]+/i);
  const epUrl = (baseM ? baseM[0] : HENTAIHAVEN_BASE) + targetEp.url;
  const epHtml = await fetchHentaiHtml(epUrl, 10000, 'episode', signal);
  if (!epHtml) return null;
  if (isChallengeHtml(epHtml)) {
    console.warn('[HentaiHaven] challenge wall (episode)');
    return null;
  }
  const files = parseHentaiHavenEpisodeDetail(epHtml);
  if (!files.hls && !files.mp4) {
    console.warn('[HentaiHaven] HLS not found');
    return null;
  }
  files.episodes = episodes;
  return files;
}
