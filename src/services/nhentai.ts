import type { BooruPost, BooruSource, BooruTagGroups, BooruTagSuggestion, TagCategory } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * nhentai integration - pure helpers.
 * ONLY the official v2 API (https://nhentai.net/api/v2/docs, vendored at docs/vendor/openapi-nhentai.json).
 * Mirrors (nhentai.xxx) and HTML scraping were removed entirely.
 * - List/detail: /api/v2/galleries, /api/v2/search, /api/v2/galleries/{id}
 * - Tags: POST /api/v2/tags/search
 * - Image CDN: t1/i1.nhentai.net (paths provided by the API are used)
 * - Score = num_favorites (score maps one-to-one to the favorite count)
 */

export const NHENTAI_BASE = 'https://nhentai.net';
export const NHENTAI_IMAGE_BASE = 'https://i3.nhentai.net';
export const NHENTAI_THUMB_BASE = 'https://t2.nhentai.net';

/**
 * Official v2 API (https://nhentai.net/api/v2/docs).
 * Score maps directly to the `num_favorites` value.
 *
 * CDN NOTE (verified on device): t1/i1 hosts are blocked/unresolvable on some networks
 * (t1 does not open in Safari, t2/t3 do). So the default cover is t3,
 * the fallback cover is t2, full pages come via i3; cards still show images
 * when a single host is down (PostCard thumb->cover fallback).
 */
export const NHENTAI_API_BASE = 'https://nhentai.net/api/v2';
export const NHENTAI_API_THUMB_BASE = 'https://t2.nhentai.net';
export const NHENTAI_API_THUMB_FALLBACK_BASE = 'https://t3.nhentai.net';
export const NHENTAI_API_IMAGE_BASE = 'https://i3.nhentai.net';

/**
 * v2 API requests mimic Safari exactly (verified on device: the same URL
 * opened in Safari but stalled in the app — bot protection flagged the request
 * fingerprint and would not stream the body).
 * - Full Safari form (`Version/18.x ... Safari/604.1` tokens): distinguished from
 *   a tokenless WKWebView-smelling form.
 * - No Referer (like direct navigation).
 * - No Accept-Encoding interference (RN/NSURLSession default + transparent handling;
 *   a manual header could break body streaming).
 */
export const NHENTAI_API_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';

/** The single header set used in all v2 API JSON calls. */
export function nhentaiApiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': NHENTAI_API_UA,
    Accept: 'application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(extra || {}),
  };
}

const EXT_MAP: Record<string, string> = {
  j: 'jpg',
  p: 'png',
  w: 'webp',
  g: 'gif',
};

export function extFromType(t: string | undefined): string {
  if (!t) return 'jpg';
  const clean = t.toLowerCase().trim();
  return EXT_MAP[clean] || (clean.length <= 4 ? clean : 'jpg');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export interface NHentaiPageInfo {
  page: number;
  url: string;
  width?: number;
  height?: number;
}

export interface NHentaiGalleryDetail {
  id: string;
  mediaId: string;
  title: string;
  pageCount: number;
  pages: string[];
  coverUrl: string;
  tags: BooruTagGroups;
  allTags: string[];
}

/**
 * Filter order -> v2 API `sort` value.
 * v2 also supports time-ranged popularity (verified live):
 * popular / popular-today / popular-week / popular-month / date
 */
export function nhentaiApiSort(sortBy?: string, timeRange?: string): string {
  if (sortBy === 'score') {
    if (timeRange === '1d') return 'popular-today';
    if (timeRange === '1w') return 'popular-week';
    if (timeRange === '1m') return 'popular-month';
    return 'popular';
  }
  return 'date';
}

/** Known language tags (take a `language:` prefix in the meta category). */
const NHENTAI_LANGUAGE_TAGS = new Set([
  'english', 'japanese', 'chinese', 'translated', 'spanish', 'french',
  'portuguese', 'german', 'italian', 'russian', 'korean', 'vietnamese',
  'thai', 'indonesian', 'polish', 'dutch',
]);

/** Known category tags (take a `category:` prefix in the meta category). */
const NHENTAI_CATEGORY_TAGS = new Set([
  'doujinshi', 'manga', 'doujin', 'oneshot', 'anthology', 'magazine',
]);

/**
 * Builds a v2 API `prefix:"name"` query from a tag name + category
 * (https://nhentai.net/api/v2/docs: keywords, "exact phrase", -negation,
 * `artist:name`, `language:english`, `tag:"big breasts"`, `favorites:>=100`).
 * Plain keyword search full-text matches titles; the `tag:` prefix does a REAL
 * tag match (e.g. `big breasts` 237,388 vs `tag:"big breasts"` 236,569
 * with a different first result — verified live).
 * Already-prefixed input is normalized (`tag:big breasts` -> `tag:"big breasts"`).
 * Unknown meta categories stay unprefixed (a wrong prefix risks empty results).
 */
export function nhentaiTagQuery(name: string, category?: TagCategory | string): string {
  const clean = (name || '').trim().replace(/^"+|"+$/g, '').trim();
  if (!clean) return '';
  const prefixed = clean.match(/^([a-z][a-z-]*):(.*)$/i);
  if (prefixed) {
    const val = prefixed[2].trim().replace(/^"+|"+$/g, '').trim();
    if (!val) return clean;
    return /\s/.test(val)
      ? `${prefixed[1].toLowerCase()}:"${val}"`
      : `${prefixed[1].toLowerCase()}:${val}`;
  }
  const quoted = (s: string) => `"${s.replace(/"/g, '')}"`;
  switch ((category || '').toLowerCase()) {
    case 'artist':
      return `artist:${quoted(clean)}`;
    case 'character':
      return `character:${quoted(clean)}`;
    case 'copyright':
      return `parody:${quoted(clean)}`;
    case 'general':
      return `tag:${quoted(clean)}`;
    case 'meta': {
      const lower = clean.toLowerCase();
      if (NHENTAI_LANGUAGE_TAGS.has(lower)) return `language:${quoted(clean)}`;
      if (NHENTAI_CATEGORY_TAGS.has(lower)) return `category:${quoted(clean)}`;
      return clean;
    }
    default:
      return clean;
  }
}

/**
 * v2 API candidate URLs (per the official docs: https://nhentai.net/api/v2/docs).
 * - Newest (unfiltered): GET /api/v2/galleries?page={p}&per_page=25
 * - Today's popular (keywordless): GET /api/v2/galleries/popular (page 1 only,
 *   94ms — same pool as `query=*&sort=popular-today` but many times faster)
 * - Popular stream (keywordless): GET /api/v2/search?query=*&sort={sort}&page={p}
 *   (per docs, query=* returns the whole archive; 650,000+ galleries pageable).
 *   NOTE: `*` + time-ranged sorts take seconds server-side (popular-month
 *   measured ~4s); the client timeout is generously sized accordingly, NO retry
 *   (each retry burns rate-limit budget: anonymous search 10 req/min).
 * - Search: GET /api/v2/search?query={q}&sort={sort}&page={p}
 *   (docs: keywords, "exact phrase", -negation, artist:x, tag:x, favorites:>=X).
 */
export function buildNHentaiApiCandidates(
  page: number,
  keyword: string,
  sort: string = 'date',
  minScore?: number
): string[] {
  const p = Math.max(1, page);
  let q = (keyword || '').trim();

  // Server-side favorite (score) filter: API docs support `favorites:>=100`
  if (minScore && minScore > 0 && !q.includes('favorites:')) {
    q = q ? `${q} favorites:>=${minScore}` : `favorites:>=${minScore}`;
  }

  if (!q) {
    if (sort === 'popular-today') {
      return p <= 1 ? [`${NHENTAI_API_BASE}/galleries/popular`] : [];
    }
    if (sort !== 'date') {
      // Keywordless popular stream: query=* pages the whole archive by popularity (25/page)
      return [`${NHENTAI_API_BASE}/search?query=*&sort=${sort}&page=${p}`];
    }
    return [`${NHENTAI_API_BASE}/galleries?page=${p}&per_page=25`];
  }

  return [
    `${NHENTAI_API_BASE}/search?query=${encodeURIComponent(q)}&sort=${sort}&page=${p}`,
  ];
}

/**
 * v2 list parser. `num_favorites` -> score/favCount (score equals the favorite count).
 * Images come from the t1/i1 CDN; the list only gives tag_ids (names resolve in detail).
 */
export function parseNHentaiV2Listing(jsonText: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!jsonText) return posts;
  try {
    const data = JSON.parse(jsonText);
    const items = Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [];
    const base = (source.baseUrl || NHENTAI_BASE).replace(/\/$/, '');
    for (const item of items) {
      if (!item || !item.id || !item.media_id) continue;
      if (item.blacklisted) continue;
      const id = String(item.id);
      const mediaId = String(item.media_id);
      const title = decodeEntities(
        String(item.english_title || item.japanese_title || ('Gallery #' + id))
      ).trim();
      const thumbPath = String(item.thumbnail || '');
      const thumb = thumbPath.startsWith('http')
        ? thumbPath
        : `${NHENTAI_API_THUMB_BASE}/${thumbPath.replace(/^\//, '')}`;
      // The extension is preserved on the CDN (thumb.webp vs thumb.jpg) — the page-1 URL
      // gives a 404 on jpg galleries if hardcoded to .webp (verified live).
      const extMatch = thumb.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i);
      const ext = (extMatch ? extMatch[1].toLowerCase() : 'webp').replace('jpeg', 'jpg');
      // Fallback cover from a different host (t2): if the primary CDN host is down,
      // PostCard's thumb->cover fallback still brings an image.
      const cover = thumb
        .replace(/\/thumb\./i, '/cover.')
        .replace(NHENTAI_API_THUMB_BASE, NHENTAI_API_THUMB_FALLBACK_BASE);
      // Thumb fallback on the NEXT cdn host (t2 primary -> t3), same path/extension.
      // Derived from the thumb path (not the cover path): one dead thumb host must
      // not leave every card at "Cover unavailable". Absolute thumb URLs and
      // unparsable hosts yield null -> field stays omitted instead of a broken URL.
      const previewFallback = rotateNhentaiThumbHost(thumb) || undefined;
      const width = Number(item.thumbnail_width) || 250;
      const height = Number(item.thumbnail_height) || 350;
      const aspectRatio = width > 0 && height > 0 ? width / height : 250 / 350;
      const favorites = Number(item.num_favorites) || 0;
      const pageCount = Number(item.num_pages) || 0;

      posts.push({
        id: 'nh_' + id,
        sourceId: source.id,
        sourceName: source.name,
        title: title || undefined,
        previewUrl: thumb,
        previewFallbackUrl: previewFallback,
        sampleUrl: cover,
        originalUrl: `${NHENTAI_API_IMAGE_BASE}/galleries/${mediaId}/1.${ext}`,
        width,
        height,
        aspectRatio,
        rating: 'e',
        score: favorites,
        favCount: favorites,
        tags: { artist: [], character: [], copyright: [], general: [], meta: ['manga'] },
        allTags: [],
        sourceLink: `https://nhentai.net/g/${id}/`,
        fileExt: ext,
        createdAt: new Date().toISOString(),
        pageCount: pageCount > 0 ? pageCount : undefined,
        mediaId,
      });
    }
  } catch (e) {
    console.warn('[nhentai] v2 JSON parse error:', e);
  }
  return posts;
}

/**
 * Extracts ALL page URLs of a manga from gallery detail JSON (v2: /api/v2/galleries/{id}).
 * v1 JSON (`images.pages`) is supported for backward compatibility.
 */
export function parseNHentaiGalleryPages(
  raw: string,
  galleryId?: string
): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return [];

  try {
    const data = JSON.parse(trimmed);
    // v2: pages: [{number, path, width, height}]
    // `number` is NOT guaranteed (older/partial payloads only carry `path`), so the
    // array index is the ordering fallback. A page with a usable path is ALWAYS kept:
    // dropping it on a missing `number` emptied the whole reader (black screen).
    if (Array.isArray(data?.pages)) {
      const v2Pages = data.pages
        .map((p: any, idx: number) => {
          const path = typeof p === 'string' ? p : p?.path;
          if (!path) return '';
          const n =
            typeof p === 'object' && typeof p?.number === 'number' && p.number > 0
              ? p.number
              : idx + 1;
          const abs = String(path).startsWith('http')
            ? String(path)
            : `${NHENTAI_API_IMAGE_BASE}/${String(path).replace(/^\//, '')}`;
          return `${n}|${abs}`;
        })
        .filter(Boolean)
        .sort((a: string, b: string) => Number(a.split('|')[0]) - Number(b.split('|')[0]))
        .map((s: string) => s.slice(s.indexOf('|') + 1));
      if (v2Pages.length > 0) return v2Pages;
    }
    // v1 (and v2 payloads that nest full paths under images.pages)
    const mediaId = data?.media_id;
    const pages = data?.images?.pages;
    if (mediaId && Array.isArray(pages)) {
      return pages.map((p, idx) => {
        // A nested path is authoritative (keeps the real CDN extension).
        if (typeof p?.path === 'string' && p.path) {
          return String(p.path).startsWith('http')
            ? String(p.path)
            : `${NHENTAI_API_IMAGE_BASE}/${String(p.path).replace(/^\//, '')}`;
        }
        const ext = extFromType(p?.t);
        return `${NHENTAI_IMAGE_BASE}/galleries/${mediaId}/${idx + 1}.${ext}`;
      });
    }
  } catch {}

  return [];
}

export interface NHentaiResolvedGallery {
  pages: string[];
  tags: BooruTagGroups;
  allTags: string[];
  pageCount: number;
  /** Favorite count from v2 detail (score); undefined if absent */
  numFavorites?: number;
}

/** Extracts tag groups from v2 detail JSON (names + types are included). */
export function parseNHentaiV2DetailTags(jsonText: string): { tags: BooruTagGroups; allTags: string[]; numFavorites: number } {
  const tags: BooruTagGroups = { artist: [], character: [], copyright: [], general: [], meta: ['manga'] };
  const allTags: string[] = [];
  let numFavorites = 0;
  if (!jsonText) return { tags, allTags, numFavorites };
  try {
    const data = JSON.parse(jsonText);
    numFavorites = Number(data?.num_favorites) || 0;
    const list = Array.isArray(data?.tags) ? data.tags : [];
    const seen = new Set<string>();
    for (const t of list) {
      const name = decodeEntities(String(t?.name || '')).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      allTags.push(name);
      const type = String(t?.type || '').toLowerCase();
      if (type === 'artist' || type === 'group') tags.artist.push(name);
      else if (type === 'character') tags.character.push(name);
      else if (type === 'parody') tags.copyright.push(name);
      else if (type === 'tag') tags.general.push(name);
      else tags.meta.push(name);
    }
  } catch {}
  return { tags, allTags, numFavorites };
}

/**
 * Resolves nhentai gallery detail (pages + tags + favorite count) directly
 * from the official v2 API (https://nhentai.net/api/v2/docs).
 */
export async function resolveNHentaiGalleryDetail(
  post: { id?: string; sourceLink?: string; mediaId?: string; pageCount?: number; fileExt?: string },
  signal?: AbortSignal
): Promise<NHentaiResolvedGallery> {
  const empty: NHentaiResolvedGallery = {
    pages: [],
    tags: { artist: [], character: [], copyright: [], general: [], meta: ['manga'] },
    allTags: [],
    pageCount: post.pageCount || 0,
  };

  const rawId = (post.id || '').replace(/^nh_/, '');
  if (!rawId) return empty;

  const headers = nhentaiApiHeaders();

  const fetchWithTimeout = async (url: string, ms = 9000): Promise<string | null> => {
    if (signal?.aborted) return null;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), ms);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await proxyService.fetchWithFallback(url, { headers, signal: ctrl.signal }, ms);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  };

  // 1. Official v2 API detail: GET /api/v2/galleries/{id}
  const v2Text = await fetchWithTimeout(`${NHENTAI_API_BASE}/galleries/${rawId}`, 12000);
  let v2Detail: { tags: BooruTagGroups; allTags: string[]; numFavorites: number } | null = null;
  if (v2Text) {
    const pages = parseNHentaiGalleryPages(v2Text, rawId);
    const detail = parseNHentaiV2DetailTags(v2Text);
    v2Detail = detail;
    if (pages.length > 0) {
      return {
        pages,
        tags: detail.tags,
        allTags: detail.allTags,
        pageCount: pages.length,
        numFavorites: detail.numFavorites || undefined,
      };
    }
  }

  // 2. Synthetic CDN safety net (i3.nhentai.net).
  // Runs when the v2 call failed OR answered without a usable `pages` array. The
  // v2 body itself is the better metadata source (real media_id / num_pages /
  // page extension), post list metadata is the last resort.
  const synth = syntheticNHentaiPages(v2Text, post);
  if (synth.length > 0) {
    return {
      pages: synth,
      tags: v2Detail?.tags ?? empty.tags,
      allTags: v2Detail?.allTags ?? empty.allTags,
      pageCount: synth.length,
      numFavorites: v2Detail?.numFavorites || undefined,
    };
  }

  return empty;
}

/**
 * Builds page URLs from metadata alone (no per-page paths): media_id + page count
 * + extension. Used as the safety net when the detail payload carries no usable
 * `pages` entries, so the reader still gets real images instead of an empty list.
 */
function syntheticNHentaiPages(
  v2Text: string | null,
  post: { mediaId?: string; pageCount?: number; fileExt?: string }
): string[] {
  let mediaId = post.mediaId ? String(post.mediaId) : '';
  let pageCount = Number(post.pageCount) || 0;
  let ext = (post.fileExt || '').toLowerCase().replace('jpeg', 'jpg');

  if (v2Text) {
    try {
      const data = JSON.parse(v2Text);
      const apiMediaId = data?.media_id;
      if (!mediaId && apiMediaId !== undefined && apiMediaId !== null) {
        mediaId = String(apiMediaId);
      }
      const apiPageCount = Number(data?.num_pages) || 0;
      if (apiPageCount > 0) pageCount = apiPageCount;
      else if (Array.isArray(data?.pages) && data.pages.length > 0) pageCount = data.pages.length;
      const first = Array.isArray(data?.pages) ? data.pages[0] : undefined;
      const firstPath = typeof first === 'string' ? first : first?.path;
      const m = String(firstPath || '').match(/\.([a-z0-9]{2,4})(?:\?|$)/i);
      if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    } catch {}
  }

  if (!mediaId || pageCount <= 0) return [];
  if (!ext) ext = 'webp';

  const pages: string[] = [];
  for (let p = 1; p <= pageCount; p++) {
    pages.push(`${NHENTAI_API_IMAGE_BASE}/galleries/${mediaId}/${p}.${ext}`);
  }
  return pages;
}

/**
 * Resolves nhentai manga pages (backward compatible for MangaReaderView).
 */
export async function resolveNHentaiPages(
  post: { id?: string; sourceLink?: string; mediaId?: string; pageCount?: number },
  signal?: AbortSignal
): Promise<string[]> {
  const detail = await resolveNHentaiGalleryDetail(post, signal);
  return detail.pages;
}

/**
 * Popular nhentai tags and terms (instant autocomplete in the search bar).
 */
const COMMON_NHENTAI_TAGS: Array<{ name: string; category: TagCategory; postCount: number }> = [
  // Parodies (Copyright)
  { name: 'genshin impact', category: 'copyright', postCount: 4200 },
  { name: 'blue archive', category: 'copyright', postCount: 3800 },
  { name: 'fate grand order', category: 'copyright', postCount: 8900 },
  { name: 'naruto', category: 'copyright', postCount: 2900 },
  { name: 'one piece', category: 'copyright', postCount: 2100 },
  { name: 'pokemon', category: 'copyright', postCount: 2600 },
  { name: 'honkai star rail', category: 'copyright', postCount: 1900 },
  { name: 'hololive', category: 'copyright', postCount: 2400 },
  { name: 'neon genesis evangelion', category: 'copyright', postCount: 3100 },
  { name: 'dragon ball z', category: 'copyright', postCount: 1200 },
  { name: 'bleach', category: 'copyright', postCount: 1400 },
  { name: 'idolmaster', category: 'copyright', postCount: 7800 },
  { name: 'kantai collection', category: 'copyright', postCount: 8500 },
  { name: 'touhou project', category: 'copyright', postCount: 14000 },
  { name: 'original', category: 'copyright', postCount: 35000 },

  // Characters
  { name: 'asuka langley soryu', category: 'character', postCount: 1400 },
  { name: 'raiden shogun', category: 'character', postCount: 850 },
  { name: 'tifa lockhart', category: 'character', postCount: 920 },
  { name: 'ganyu', category: 'character', postCount: 780 },
  { name: 'yelan', category: 'character', postCount: 610 },
  { name: 'hinata hyuga', category: 'character', postCount: 890 },
  { name: 'tsunade', category: 'character', postCount: 760 },
  { name: 'remi', category: 'character', postCount: 430 },
  { name: 'artoria pendragon', category: 'character', postCount: 1100 },

  // General Tags
  { name: 'sole female', category: 'general', postCount: 115000 },
  { name: 'sole male', category: 'general', postCount: 98000 },
  { name: 'big breasts', category: 'general', postCount: 145000 },
  { name: 'nakadashi', category: 'general', postCount: 68000 },
  { name: 'blowjob', category: 'general', postCount: 56000 },
  { name: 'schoolgirl uniform', category: 'general', postCount: 62000 },
  { name: 'stockings', category: 'general', postCount: 72000 },
  { name: 'anal', category: 'general', postCount: 74000 },
  { name: 'milf', category: 'general', postCount: 39000 },
  { name: 'glasses', category: 'general', postCount: 54000 },
  { name: 'netorare', category: 'general', postCount: 28000 },
  { name: 'bondage', category: 'general', postCount: 37000 },
  { name: 'paizuri', category: 'general', postCount: 29000 },
  { name: 'femdom', category: 'general', postCount: 24000 },
  { name: 'maid', category: 'general', postCount: 14000 },
  { name: 'swimsuit', category: 'general', postCount: 22000 },
  { name: 'x-ray', category: 'general', postCount: 27000 },
  { name: 'uncensored', category: 'general', postCount: 12000 },
  { name: 'yuri', category: 'general', postCount: 26000 },
  { name: 'yaoi', category: 'general', postCount: 19000 },
  { name: 'ahegao', category: 'general', postCount: 34000 },
  { name: 'cheating', category: 'general', postCount: 18000 },
  { name: 'dilf', category: 'general', postCount: 12000 },
  { name: 'cosplay', category: 'general', postCount: 15000 },

  // Meta
  { name: 'english', category: 'meta', postCount: 108000 },
  { name: 'translated', category: 'meta', postCount: 112000 },
  { name: 'japanese', category: 'meta', postCount: 250000 },
  { name: 'manga', category: 'meta', postCount: 350000 },
  { name: 'color', category: 'meta', postCount: 16000 },
];

/** v2 tag type -> app category */
function nhentaiTagCategory(type: string): TagCategory {
  switch (type.toLowerCase()) {
    case 'artist':
    case 'group':
      return 'artist';
    case 'character':
      return 'character';
    case 'parody':
      return 'copyright';
    case 'language':
    case 'category':
      return 'meta';
    default:
      return 'general';
  }
}

/**
 * v2 tag search (official POST /api/v2/tags/search endpoint).
 * Returns all types (parody, character, artist, group, tag) in a single call
 * with real post counts.
 */
export async function searchNHentaiApiTags(
  query: string,
  limit: number = 12
): Promise<BooruTagSuggestion[]> {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    const url = `${NHENTAI_API_BASE}/tags/search`;
    const res = await proxyService.fetchWithFallback(
      url,
      {
        method: 'POST',
        headers: nhentaiApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: q, limit: Math.min(50, Math.max(5, limit)) }),
      },
      5000
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((t: any) => {
        const name = decodeEntities(String(t?.name || '')).trim();
        if (!name) return null;
        return {
          name,
          category: nhentaiTagCategory(String(t?.type || 'tag')),
          postCount: Number(t?.count) || 0,
        };
      })
      .filter(Boolean) as BooruTagSuggestion[];
  } catch {
    return [];
  }
}

/**
 * nhentai tag search / autocomplete.
 * Order: local pool (instant) -> official v2 POST /api/v2/tags/search.
 */
export async function searchNHentaiTags(
  query: string,
  limit: number = 12
): Promise<BooruTagSuggestion[]> {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];

  const results: BooruTagSuggestion[] = [];
  const seen = new Set<string>();

  // 1. Local fast match (instant response)
  for (const tag of COMMON_NHENTAI_TAGS) {
    if (tag.name.toLowerCase().includes(q)) {
      results.push(tag);
      seen.add(tag.name.toLowerCase());
      if (results.length >= limit) break;
    }
  }

  // 2. Official v2 API tag search (POST /api/v2/tags/search)
  if (results.length < limit) {
    const apiResults = await searchNHentaiApiTags(q, limit);
    for (const r of apiResults) {
      if (seen.has(r.name.toLowerCase())) continue;
      seen.add(r.name.toLowerCase());
      results.push(r);
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

/**
 * Full-page CDN host rotation. Some networks block/fail to resolve individual hosts
 * (verified on device: i1 dead, i2/i3 alive). On a page error the next host
 * is tried; null when the list is exhausted (give up).
 * i3 goes first: i1/i2 are blocked on some networks, i3 is the most widely reachable.
 */
export const NHENTAI_API_IMAGE_HOSTS = [
  'https://i3.nhentai.net',
  'https://i2.nhentai.net',
  'https://i4.nhentai.net',
  'https://i1.nhentai.net',
];

export function rotateNhentaiImageHost(url: string | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^(https?:\/\/i\d\.nhentai\.net)(\/.*)$/i);
  if (!m) return null;
  const idx = NHENTAI_API_IMAGE_HOSTS.findIndex(
    (h) => h.toLowerCase() === m[1].toLowerCase()
  );
  if (idx < 0 || idx + 1 >= NHENTAI_API_IMAGE_HOSTS.length) return null;
  return `${NHENTAI_API_IMAGE_HOSTS[idx + 1]}${m[2]}`;
}

/**
 * Thumb/cover CDN host rotation for cards (t2 -> t3 -> t4 -> t1).
 * The same path is served by all t-hosts (webp/png/jpg verified live), so one
 * blocked or unreachable host can be skipped without losing the image.
 * Protocol, path and query string are preserved. t1 is the end of the list:
 * null there (give up) rather than looping back to a host that already failed.
 */
export const NHENTAI_THUMB_HOSTS = ['t2', 't3', 't4', 't1'];

export function rotateNhentaiThumbHost(url: string | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^(https?:\/\/)(t\d)\.nhentai\.net(\/.*)$/i);
  if (!m) return null;
  const idx = NHENTAI_THUMB_HOSTS.indexOf(m[2].toLowerCase());
  if (idx < 0 || idx + 1 >= NHENTAI_THUMB_HOSTS.length) return null;
  return `${m[1]}${NHENTAI_THUMB_HOSTS[idx + 1]}.nhentai.net${m[3]}`;
}
