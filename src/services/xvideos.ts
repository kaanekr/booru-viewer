import type { BooruPost, BooruSource } from '../types/booru';

/**
 * XVideos (https://www.xvideos.com) integration — pure helpers.
 * Source: endpoints used by the rodrigogs/xvideos library (verified live):
 * - Search: GET /?k=<word>&sort=..&durf=..&datef=..&quality=..[&p=<page-1>]
 *   (no `p` on page 1; p is zero-based: p=1 → page 2)
 * - Keywordless list: GET /new[/<page>] (fresh)
 * - Cards: `id="video_<eid>" data-id="<numeric>"` thumb-block divs
 * - Detail: html5player.setVideoUrlLow/High (mp4) + setVideoHLS (m3u8),
 *   tags: a[href*="/tags/"]
 * No React import — can be tested directly with node.
 */

export const XVIDEOS_BASE = 'https://www.xvideos.com';

/** Desktop UA for search/list HTML (a mobile UA may return different markup). */
export const XVIDEOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

export type XVideosSort = 'relevance' | 'uploaddate' | 'rating' | 'length' | 'views' | 'random';
export type XVideosDatef = 'today' | 'week' | 'month' | '3month' | '6month' | 'all';

/** App's TimeRangeOption equivalent (no 1y range on site → 'all'). */
export function xvideosDatefForTimeRange(timeRange: string | undefined): XVideosDatef {
  if (timeRange === '1d') return 'today';
  if (timeRange === '1w') return 'week';
  if (timeRange === '1m') return 'month';
  return 'all';
}

export function buildXVideosSearchUrl(
  baseUrl: string,
  page: number,
  k: string,
  sort: XVideosSort,
  datef: XVideosDatef,
  bestMonth?: string
): string {
  return buildXVideosSearchCandidates(baseUrl, page, k, sort, datef, bestMonth)[0];
}

/**
 * Candidate URLs to try in order (the library's loadListingPage logic):
 * the site 404s on some variants (e.g. `/new` 404s, `/new/1` 200s) or
 * returns an empty list; the first non-empty result wins.
 *
 * Keywordless discover: page 1 is the site homepage (daily picks), deeper
 * pages are the month's most popular (`/best` redirects to the current month,
 * `/best/YYYY-MM`). When the month is unknown the redirect is resolved; if it
 * cannot be resolved it falls back to the `/new` variants.
 */
export function buildXVideosSearchCandidates(
  baseUrl: string,
  page: number,
  k: string,
  sort: XVideosSort,
  datef: XVideosDatef,
  bestMonth?: string
): string[] {
  const base = (baseUrl || XVIDEOS_BASE).replace(/\/$/, '');
  const keyword = (k || '').trim();
  if (!keyword) {
    const m = (bestMonth || '').match(/^\d{4}-\d{2}$/) ? (bestMonth as string) : '';
    // Explicit browse orders must not silently fall back to the homepage.
    // /new/1 and /best -> /best/YYYY-MM were verified with parsed cards.
    if (sort === 'uploaddate') return [`${base}/new/${Math.max(1, page)}`];
    if (sort === 'views' && datef === 'month') {
      if (page <= 1) return [`${base}/best`];
      return m ? [`${base}/best/${m}/${page - 1}`] : [];
    }
    if (page <= 1) {
      return m
        ? [`${base}/`, `${base}/best/${m}`, `${base}/best`, `${base}/new/1`]
        : [`${base}/`, `${base}/best`, `${base}/new`, `${base}/new/1`];
    }
    if (m) return [`${base}/best/${m}/${page - 1}`, `${base}/new/${page}`];
    return [`${base}/new/${page}`];
  }
  const make = (p: number | undefined): string => {
    const qp = new URLSearchParams({
      k: keyword,
      sort,
      durf: 'allduration',
      datef,
      quality: 'all',
    });
    if (p !== undefined) qp.set('p', String(p));
    return `${base}/?${qp.toString()}`;
  };
  if (page <= 1) return [make(undefined)];
  // p is zero-based (p=1 → page 2); both are tried
  return [make(page - 1), make(page)];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeScriptValue(s: string): string {
  return s
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&')
    .trim();
}

export function parseXVideosTags(html: string): string[] {
  const tags = new Map<string, string>();
  const links = /<a\b[^>]*\bhref=(['"])(?:https?:\/\/[^/'"]+)?\/tags\/[^/'"?#]+\/?(?:[?#][^'"]*)?\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(links)) {
    const content = match[2].replace(/<span\b[^>]*\bnavbadge\b[^>]*>[\s\S]*?<\/span>/gi, '');
    const label = decodeEntities(content.replace(/<[^>]*>/g, '')).trim();
    if (label && !tags.has(label.toLowerCase())) tags.set(label.toLowerCase(), label);
  }
  return [...tags.values()];
}

/** Extracts the current month (`YYYY-MM`) from `/best` HTML (from the pagination link). */
export function extractXVideosBestMonth(html: string): string {
  if (!html) return '';
  const m = html.match(/\/best\/(\d{4}-\d{2})\/\d+/);
  return m ? m[1] : '';
}

/**
 * Extracts cards from search/listing HTML. Every card is a video
 * (the site is video-only; there are no photos).
 *
 * Two card structures are supported:
 * - Klasik: `id="video_<eid>" data-id="<numeric>"` thumb-block div'leri
 * - New (`/best` pages): `id="video-thumb-<enc>"` + `data-video` JSON
 *   (numeric id, encodedId, previewVideo mp4)
 */
export function parseXVideosListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  const seen = new Set<string>();
  const base = (source.baseUrl || XVIDEOS_BASE).replace(/\/$/, '');
  const mediaUrl = (value: string): string => {
    const url = decodeScriptValue(value);
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${base}${url}`;
    return /^https?:\/\//i.test(url) ? url : '';
  };
  const thumbnailFrames = (url: string): string[] | undefined => {
    if (url.includes('THUMBNUM')) {
      return [1, 2, 3, 4, 5, 6, 7, 8].map((num) => url.replace(/THUMBNUM/g, String(num)));
    }
    const match = url.match(/_(\d+)_t\.(jpg|jpeg|webp|avif)/i);
    return match ? [1, 3, 5, 7, 10, 15, 20, 25].map((num) =>
      url.replace(/_\d+_t\.(jpg|jpeg|webp|avif)/i, `_${num}_t.${match[2]}`)) : undefined;
  };

  // Each card starts with `id="video_<eid>"`; split the chunk and read from inside the card.
  const chunks = html.split('id="video_');
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];

    const idM = c.match(/data-id="(\d+)"/);
    const hrefM = c.match(/<a[^>]*href="(\/video\.[^"]+)"/);
    if (!idM || !hrefM) continue;
    const dataId = idM[1];
    if (seen.has(dataId)) continue;

    const thumbM =
      c.match(/data-src="([^"]+)"/) || c.match(/<img[^>]*src="([^"]+)"/);
    const template = thumbM ? mediaUrl(thumbM[1]) : '';
    const preview = template.replace(/THUMBNUM/g, '1');
    if (!preview) continue;

    const pvvM = c.match(/data-pvv="([^"]+\.mp4[^"]*)"/i);
    const previewVideo = pvvM ? mediaUrl(pvvM[1]) || undefined : undefined;

    const previewThumbs = thumbnailFrames(template);

    const titleM =
      c.match(/<p class="title"><a[^>]*title="([^"]+)"/) ||
      c.match(/<div class="title" title="([^"]+)"/) ||
      c.match(/title="([^"]+)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';

    const profM = c.match(/<(?:span|a) class="name"[^>]*>([^<]+)</);
    const profile = profM ? decodeEntities(profM[1]).trim() : '';

    // Quality marker (e.g. >720p< / >360p<) -> 16:9 dimension estimate
    let height = 720;
    const qM = c.match(/>(\d{3,4})p</);
    if (qM) {
      const q = parseInt(qM[1], 10);
      if (Number.isFinite(q) && q >= 144 && q <= 2160) height = q;
    }
    const width = Math.round((height * 16) / 9);

    const href = decodeEntities(hrefM[1]);
    const artist = profile ? [profile] : [];

    seen.add(dataId);
    posts.push({
      id: `xv_${dataId}`,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: preview,
      previewVideoUrl: previewVideo,
      previewThumbs,
      sampleUrl: preview,
      // The original mp4 is secure-tokenized and may be time-limited; it is not
      // embedded in the listing — it is resolved fresh from the detail page on
      // viewer open.
      originalUrl: '',
      width,
      height,
      aspectRatio: width > 0 && height > 0 ? width / height : 16 / 9,
      rating: 'e',
      score: 0,
      favCount: 0,
      tags: {
        artist,
        character: [],
        copyright: [],
        general: [],
        meta: ['video'],
      },
      allTags: [...artist],
      sourceLink: `${base}${href}`,
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  // New card structure (`/best` pages): `id="video-thumb-<enc>"` divs.
  // Numeric id and preview mp4 come from the `data-video` JSON, title/thumb
  // from inside the card; the output shape matches the classic structure.
  const bestChunks = html.split('id="video-thumb-');
  for (let i = 1; i < bestChunks.length; i++) {
    const c = bestChunks[i];

    let vid = 0;
    let enc = '';
    let previewVideo: string | undefined;
    const jsonM = c.match(/data-video='(\{.*?\})'/);
    if (jsonM) {
      try {
        const j = JSON.parse(jsonM[1]);
        if (j && typeof j.id === 'number' && Number.isFinite(j.id)) vid = j.id;
        if (j && typeof j.encodedId === 'string') enc = j.encodedId.trim();
        if (j && typeof j.previewVideo === 'string' && j.previewVideo.trim()) {
          previewVideo = mediaUrl(j.previewVideo) || undefined;
        }
      } catch {
        // Broken JSON: fall through to the regexes below
      }
    }
    if (!enc) {
      const encM = c.match(/^([a-z0-9]+)"/i);
      if (encM) enc = encM[1];
    }
    if (!enc) continue;
    const key = vid ? String(vid) : enc;
    if (seen.has(key)) continue;

    const hrefM = c.match(/<a[^>]*href="(\/video\.[^"]+)"/);
    if (!hrefM) continue;
    const href = decodeEntities(hrefM[1]);

    const thumbM =
      c.match(/data-src="([^"]+)"/) || c.match(/<img[^>]*src="([^"]+)"/);
    const template = thumbM ? mediaUrl(thumbM[1]) : '';
    const preview = template.replace(/THUMBNUM/g, '1');
    if (!preview || preview.includes('blank.gif')) continue;

    if (!previewVideo) {
      const pvvM = c.match(/data-pvv="([^"]+\.mp4[^"]*)"/i);
      if (pvvM) previewVideo = mediaUrl(pvvM[1]) || undefined;
    }

    const previewThumbs = thumbnailFrames(template);

    const titleM =
      c.match(/<div class="title" title="([^"]+)"/) || c.match(/title="([^"]+)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';

    const profM = c.match(/<(?:span|a) class="name"[^>]*>([^<]+)</);
    const profile = profM ? decodeEntities(profM[1]).trim() : '';

    let height = 720;
    const qM = c.match(/>(\d{3,4})p</);
    if (qM) {
      const q = parseInt(qM[1], 10);
      if (Number.isFinite(q) && q >= 144 && q <= 2160) height = q;
    }
    const width = Math.round((height * 16) / 9);
    const artist = profile ? [profile] : [];

    seen.add(key);
    posts.push({
      id: `xv_${key}`,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: preview,
      previewVideoUrl: previewVideo,
      previewThumbs,
      sampleUrl: preview,
      originalUrl: '',
      width,
      height,
      aspectRatio: width > 0 && height > 0 ? width / height : 16 / 9,
      rating: 'e',
      score: 0,
      favCount: 0,
      tags: {
        artist,
        character: [],
        copyright: [],
        general: [],
        meta: ['video'],
      },
      allTags: [...artist],
      sourceLink: `${base}${href}`,
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  return posts;
}

export interface XVideosFiles {
  high: string;
  low: string;
  hls: string;
}

/** Extracts playable file URLs from the detail page HTML. */
export function parseXVideosFiles(html: string): XVideosFiles {
  const pick = (patterns: RegExp[]): string => {
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) {
        const v = decodeScriptValue(m[1]);
        if (v) return v;
      }
    }
    return '';
  };

  const low = pick([
    /html5player\.setVideoUrlLow\('([^']+)'/i,
    /html5player\.setVideoUrlLow\("([^"]+)"/i,
    /"videoUrlLow"\s*:\s*"([^"]+)"/i,
  ]);
  const high = pick([
    /html5player\.setVideoUrlHigh\('([^']+)'/i,
    /html5player\.setVideoUrlHigh\("([^"]+)"/i,
    /"videoUrlHigh"\s*:\s*"([^"]+)"/i,
  ]);
  let hls = pick([
    /html5player\.setVideoHLS\('([^']+)'/i,
    /html5player\.setVideoHLS\("([^"]+)"/i,
    /"videoHLS"\s*:\s*"([^"]+)"/i,
    /((?:https:)?\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*)/i,
  ]);
  if (hls.startsWith('//')) hls = `https:${hls}`;

  return { high, low, hls };
}
