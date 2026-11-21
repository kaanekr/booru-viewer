import { Platform } from 'react-native';
import { proxyService } from '../services/proxyService';
import { ImageQuality } from '../services/storage';
import { parseXVideosFiles, XVIDEOS_BASE, XVIDEOS_UA } from '../services/xvideos';
import { parseXhamsterDetail, XHAMSTER_BASE, XHAMSTER_UA } from '../services/xhamster';
import { parsePornhubDetail, PORNHUB_BASE, PORNHUB_UA } from '../services/pornhub';
import { getPostKey } from './postIdentity';
import { urlEndsWith } from './guards';
import { LruCache, getOrDedup } from './lruCache';

const RESOLVE_CACHE_MAX = 500;
const NEGATIVE_RESOLVE_TTL_MS = 60_000;

const DIMS_CACHE = new LruCache<string, { w: number; h: number; bytes?: number }>(RESOLVE_CACHE_MAX);
const DIMS_IN_FLIGHT = new Map<string, Promise<{ w: number; h: number; bytes?: number } | null>>();

/**
 * Resolves the real dimensions from the original-image link on the post page.
 * The Gelbooru list HTML carries no size info (scrape leaves an 800x1000
 * placeholder); the Info modal fills in the real WxH via this function.
 * Results are cached for the session — the same post is never fetched twice.
 */
export async function resolveRealDimensions(post: {
  id?: string;
  sourceLink?: string;
  originalUrl?: string;
  sampleUrl?: string;
  sourceId?: string;
  [key: string]: any;
} | null | undefined): Promise<{ w: number; h: number; bytes?: number } | null> {
  if (!post) return null;
  const cacheKey = post.sourceId && post.id
    ? getPostKey({ sourceId: post.sourceId, id: post.id })
    : post.sourceLink || post.originalUrl || '';
  if (cacheKey && DIMS_CACHE.has(cacheKey)) return DIMS_CACHE.get(cacheKey)!;
  const pageUrl = post.sourceLink;
  if (!pageUrl || typeof pageUrl !== 'string' || !/^https?:\/\//i.test(pageUrl)) return null;
  const dedupKey = cacheKey || pageUrl;
  return getOrDedup(DIMS_IN_FLIGHT, dedupKey, async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await proxyService.fetchWithFallback(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return null;
    const html = await res.text();
    // File size: written next to the original link on the post page
    // (e.g. "2.4 MB", "850 KB", "1,234,567 bytes")
    let foundBytes: number | undefined;
    const mbMatch = html.match(/(?:file size|size)?\s*:?\s*([\d.,]+)\s*MB\b/i);
    const kbMatch = !mbMatch && html.match(/(?:file size|size)?\s*:?\s*([\d.,]+)\s*KB\b/i);
    if (mbMatch) {
      const v = parseFloat(mbMatch[1].replace(',', '.'));
      if (Number.isFinite(v) && v > 0 && v < 500) foundBytes = Math.round(v * 1024 * 1024);
    } else if (kbMatch) {
      const v = parseFloat(kbMatch[1].replace(',', '.'));
      if (Number.isFinite(v) && v > 0 && v < 500 * 1024) foundBytes = Math.round(v * 1024);
    }

    // On sites like Gelbooru the post page may not carry the file size as text;
    // a light HEAD request to the original image URL fetches the Content-Length
    if (!foundBytes && (post.originalUrl || post.sampleUrl)) {
      try {
        const rawMediaUrl = post.originalUrl || post.sampleUrl;
        const headers = getMediaHeaders(rawMediaUrl);
        const headCtrl = new AbortController();
        const headTimeout = setTimeout(() => headCtrl.abort(), 4000);
        let headRes: Response;
        try {
          headRes = await proxyService.fetchWithFallback(rawMediaUrl as string, {
            method: 'HEAD',
            headers,
            signal: headCtrl.signal,
          });
        } finally {
          clearTimeout(headTimeout);
        }
        const cl = headRes.headers.get('content-length');
        if (cl) {
          const parsed = parseInt(cl, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            foundBytes = parsed;
          }
        }
      } catch {
        // HEAD fallback is optional, never throws
      }
    }

    // 1) Original link: .../images/<d1>/<d2>/<hash>.<ext> — size is on the post page as
    //    "Size: 1456 x 2048" / "1456x2048" / image width/height attributes
    const sizeMatch =
      html.match(/Size:\s*(\d{2,5})\s*[x×]\s*(\d{2,5})/i) ||
      html.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})\s*(?:px)?\s*(?:<|\)|\||,)/i);
    if (sizeMatch) {
      const w = parseInt(sizeMatch[1], 10);
      const h = parseInt(sizeMatch[2], 10);
      if (w > 0 && h > 0 && w < 30000 && h < 30000) {
        const dims = { w, h, bytes: foundBytes };
        if (cacheKey) DIMS_CACHE.set(cacheKey, dims);
        return dims;
      }
    }
    // 2) Fallback: width/height attributes of the main image on the page
    const imgMatch = html.match(/<img[^>]*id=["']image["'][^>]*>/i);
    if (imgMatch) {
      const wM = imgMatch[0].match(/width=["']?(\d+)/i);
      const hM = imgMatch[0].match(/height=["']?(\d+)/i);
      if (wM && hM) {
        const w = parseInt(wM[1], 10);
        const h = parseInt(hM[1], 10);
        if (w > 0 && h > 0) {
          const dims = { w, h, bytes: foundBytes };
          if (cacheKey) DIMS_CACHE.set(cacheKey, dims);
          return dims;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
  });
}

export interface ImageUris {
  previewUri: string;
  sampleUri: string;
  fullUri: string;
  displayUri: string;
  placeholderUri: string;
}

/**
 * Resolves raw (unproxied) image URIs based on quality preference.
 * - preview: display is sampleUrl (fast)
 * - auto: display is sampleUrl (upgrades to full on zoom)
 * - full: display is full originalUrl
 * placeholder is always previewUrl.
 * Returns raw unproxied URLs; component calls getMediaUrl.
 */
export function getImageUris(
  post: { previewUrl?: string; sampleUrl?: string; originalUrl?: string; [key: string]: any } | null | undefined,
  quality: ImageQuality = 'auto'
): ImageUris {
  if (!post) {
    return {
      previewUri: '',
      sampleUri: '',
      fullUri: '',
      displayUri: '',
      placeholderUri: '',
    };
  }

  const preview = post.previewUrl || '';
  const sample = post.sampleUrl || post.originalUrl || preview;
  const full = post.originalUrl || post.sampleUrl || preview;

  let display: string;
  if (quality === 'full') {
    display = full;
  } else if (quality === 'preview') {
    display = sample || preview;
  } else {
    // 'auto': default to sample for fast initial render
    display = sample;
  }

  const placeholder = preview || sample;

  return {
    previewUri: preview,
    sampleUri: sample,
    fullUri: full,
    displayUri: display,
    placeholderUri: placeholder,
  };
}

/**
 * Normalizes booru media URLs (replaces deprecated CDN domains, repairs SSL issues).
 */
export function normalizeBooruMediaUrl(url: string | undefined): string {
  if (typeof url !== 'string' || !url) return '';
  let u = url.trim();
  if (u.startsWith('//')) u = 'https:' + u;

  // HH's API wraps some new covers in a broken himg.nl path (404).
  // The embedded filename lives directly under /images/ on the active CDN.
  u = u.replace(
    /^https?:\/\/himg\.nl\/images\/hh\/images\/([^?#]+\.(?:jpe?g|png|webp))\/s_poster\.jpg([?#].*)?$/i,
    'https://img.hentaihaven.xxx/images/$1$2'
  );

  // 1. Gelbooru CDN Fixes:
  // img1, img2, img3, video-cdn1..4, and apex gelbooru.com/thumbnails/ have broken SSL, DNS, or 404s.
  // img4.gelbooru.com is the active, valid CDN with full SSL.
  if (u.includes('gelbooru.com')) {
    u = u.replace(/^https?:\/\/[a-z0-9.-]*gelbooru\.com\/(images|thumbnails|samples)\//i, 'https://img4.gelbooru.com/$1/');
    u = u.replace(/^https?:\/\/[a-z0-9-]+\.gelbooru\.com\//i, 'https://img4.gelbooru.com/');
    u = u.replace(/^https?:\/\/gelbooru\.com\//i, 'https://img4.gelbooru.com/');
  } else if (u.startsWith('http://')) {
    u = u.replace('http://', 'https://');
  }

  // 2. XHamster CDN: iOS AVPlayer can't decode av1; normalize to h264
  if (u.includes('xhcdn') || u.includes('xhamster')) {
    u = u.replace(/([._-])av1([._-])/gi, '$1h264$2').replace(/\.av1\./gi, '.h264.');
  }

  // 3. Cum.st CDN migration: e1.cum.st DNS is retired (530); active media CDN is cdn.cum.st
  if (/^https?:\/\/e\d*\.cum\.st\//i.test(u)) {
    u = u.replace(/^https?:\/\/e\d*\.cum\.st\//i, 'https://cdn.cum.st/');
  }

  return u;
}

/**
 * Gets the ready-to-load media URL. When the global toggle is on, all traffic
 * goes via the Worker; when off, only TLS-fragile hosts
 * (e.g. api-cdn-mp4.rule34.xxx) are selectively proxied if a worker is registered.
 */
export function getMediaUrl(url: string | undefined): string {
  if (!url) return '';
  const normalized = normalizeBooruMediaUrl(url);
  return proxyService.proxyUrl(normalized);
}

const EPHEMERAL_QUERY_PARAMS = new Set([
  't', 'e', 'exp', 'expires', 'token', 'sig', 'signature', 'hash', 's',
  'hdnts', 'policy', 'key-pair-id', 'validfrom', 'validto', 'ip', 'ipa', 'h',
]);

/**
 * Produces a stable expo-image cacheKey by unwrapping any Worker proxy prefix
 * (?url=...) and stripping ephemeral auth/expiry query params so direct and
 * proxied loads (and token-rotated URLs) share a single disk cache entry.
 */
export function getImageCacheKey(url: string | undefined): string {
  if (!url || typeof url !== 'string') return '';
  let candidate = url.trim();
  if (!candidate) return '';

  // Unwrap proxy worker URL: https://worker.dev?url=<encoded>
  try {
    const parsed = new URL(candidate);
    const wrapped = parsed.searchParams.get('url');
    if (wrapped && /^https?:\/\//i.test(wrapped)) {
      candidate = wrapped;
    }
  } catch {}

  candidate = normalizeBooruMediaUrl(candidate);
  if (!candidate) return '';

  try {
    const parsed = new URL(candidate);
    let changed = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (EPHEMERAL_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      return parsed.toString();
    }
  } catch {}
  return candidate;
}

/**
 * The original image extension can't be guessed from the list thumbnail in a
 * Gelbooru/Realbooru scrape (.jpg/.jpeg/.png/.webp varies by CDN).
 * Resolves the real original URL from the post detail page (cached, abortable).
 */
const ORIGINAL_RESOLVE_CACHE = new LruCache<string, string | null>(RESOLVE_CACHE_MAX);
const ORIGINAL_IN_FLIGHT = new Map<string, Promise<string | null>>();

export async function resolveGelbooruOriginalUrl(
  post: {
    id?: string;
    sourceId?: string;
    sourceLink?: string;
    originalUrl?: string;
    sampleUrl?: string;
  },
  signal?: AbortSignal
): Promise<string | null> {
  // Skip the fetch if the post already has a valid originalUrl different from sample
  if (post.originalUrl && post.originalUrl !== post.sampleUrl) {
    return post.originalUrl;
  }
  if (!post.sourceLink) return post.originalUrl || null;

  const cacheKey = post.sourceLink;
  if (ORIGINAL_RESOLVE_CACHE.has(cacheKey)) {
    return ORIGINAL_RESOLVE_CACHE.get(cacheKey) ?? null;
  }

  return getOrDedup(ORIGINAL_IN_FLIGHT, cacheKey, async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const onAbort = () => ctrl.abort();
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const response = await proxyService.fetchWithFallback(post.sourceLink!, {
        headers: getMediaHeaders(post.sourceLink!),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Post view status ${response.status}`);
      const html = await response.text();

      // 1) Look for the "Original image" or "View larger size" link
      const originalLinkMatch =
        html.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(?:Original image|View larger size|High resolution)<\/a>/i) ||
        html.match(/<a\s+[^>]*href=["']([^"']+\/images\/[^"']+)["']/i);

      let resolved: string | null = null;
      if (originalLinkMatch && originalLinkMatch[1]) {
        resolved = originalLinkMatch[1].replace(/&amp;/g, '&').trim();
      }

      // 2) Scan the page for /images/ file paths
      if (!resolved) {
        const imageUrls = Array.from(
          html.matchAll(/https?:\\?\/\\?\/[^'"\s<>]+\/images\/[^'"\s<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^'"\s<>]*)?/gi),
          (m) => m[0]
        );
        if (imageUrls.length > 0) {
          resolved = imageUrls[0].replaceAll('\\/', '/');
        }
      }

      // 3) OpenGraph image fallback
      if (!resolved) {
        const metaMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
        if (metaMatch && metaMatch[1] && /\/images\//i.test(metaMatch[1])) {
          resolved = metaMatch[1].trim();
        }
      }

      if (resolved) {
        if (resolved.startsWith('//')) {
          resolved = `https:${resolved}`;
        } else if (resolved.startsWith('/')) {
          const baseMatch = post.sourceLink!.match(/^https?:\/\/[^/]+/i);
          const base = baseMatch ? baseMatch[0] : 'https://gelbooru.com';
          resolved = `${base}${resolved}`;
        }
        ORIGINAL_RESOLVE_CACHE.set(cacheKey, resolved);
        return resolved;
      }

      ORIGINAL_RESOLVE_CACHE.set(cacheKey, null, NEGATIVE_RESOLVE_TTL_MS);
      return null;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === 'AbortError') {
        return null;
      }
      ORIGINAL_RESOLVE_CACHE.set(cacheKey, null, NEGATIVE_RESOLVE_TTL_MS);
      return null;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  });
}

/**
 * Generates the correct User-Agent and Referer headers required by each Booru server.
 */
export function getMediaHeaders(url: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  };
  if (!url) return headers;

  let target = url;
  try { target = decodeURIComponent(url); } catch { /* Keep malformed escaped URLs usable. */ }

  if (target.includes('realbooru.com')) {
    headers['Referer'] = 'https://realbooru.com/';
  } else if (target.includes('gelbooru.com')) {
    headers['Referer'] = 'https://gelbooru.com/';
  } else if (target.includes('rule34.xxx') || target.includes('rule34.us')) {
    headers['Referer'] = 'https://rule34.xxx/';
  } else if (target.includes('danbooru.donmai.us') || target.includes('cdn.donmai.us')) {
    headers['Referer'] = 'https://danbooru.donmai.us/';
  } else if (target.includes('yande.re')) {
    headers['Referer'] = 'https://yande.re/';
  } else if (target.includes('cum.st') || target.includes('coomer.st')) {
    headers['Referer'] = 'https://cum.st/';
  } else if (target.includes('xvideos-cdn.com') || target.includes('xvideos.com')) {
    headers['Referer'] = 'https://www.xvideos.com/';
  } else if (target.includes('xhamster.com') || target.includes('xhamster-cdn') || target.includes('xhpingcdn.com') || target.includes('xhcdn')) {
    headers['Referer'] = 'https://xhamster.com/';
  } else if (target.includes('pornhub.com') || target.includes('phncdn.com')) {
    headers['Referer'] = 'https://www.pornhub.com/';
  } else if (target.includes('sex.com') || target.includes('sxccdn.com')) {
    headers['Referer'] = 'https://www.sex.com/';
  } else if (target.includes('hentaihaven.xxx') || target.includes('coverlanyvd.org') || target.includes('octopusmanifest.org')) {
    headers['Referer'] = 'https://hentaihaven.xxx/';
  } else if (target.includes('redgifs.com')) {
    // RedGifs CDN (media.redgifs.com) may return 403 without a Referer
    headers['Referer'] = 'https://www.redgifs.com/';
    headers['Origin'] = 'https://www.redgifs.com';
  } else if (target.includes('nhentai.net')) {
    // v2 API + t1/i1 CDN: same-site Referer (harmless on non-API cover
    // requests and softens some CF rules, though Safari doesn't send it
    // on direct navigation)
    headers['Referer'] = 'https://nhentai.net/';
  }

  return headers;
}

/**
 * Checks if a given media URL is unsupported on iOS (specifically WebM format).
 */
export function isUnsupportedOnIOS(url: string | undefined): boolean {
  if (!url) return false;
  if (Platform.OS !== 'ios') return false;
  const clean = url.split('?')[0].toLowerCase();
  return (
    clean.endsWith('.webm') ||
    clean.includes('.webm') ||
    clean.includes('.av1.') ||
    clean.endsWith('.av1')
  );
}

/**
 * Resolves playable video URLs from an XVideos detail page
 * (setVideoUrlHigh/Low mp4 + HLS, priority: high → low → hls).
 * mp4 URLs carry expiring secure tokens; deliberately NOT cached —
 * resolved fresh on every viewer open.
 */
export async function resolveXVideosVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ high: string; low: string; hls: string } | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;
  if (signal?.aborted) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await proxyService.fetchWithFallback(post.sourceLink, {
      headers: {
        'User-Agent': XVIDEOS_UA,
        Referer: `${XVIDEOS_BASE}/`,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
    });
    if (!response.ok) return null;
    const html = await response.text();
    const files = parseXVideosFiles(html);
    if (!files.high && !files.low && !files.hls) return null;
    return files;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Whether a post is a video (extension + URL). Single source for the
 * back-gesture choice and edge-area condition in the viewer.
 */
export function isVideoPost(
  post: { fileExt?: string; originalUrl?: string; sampleUrl?: string } | null | undefined
): boolean {
  if (!post) return false;
  const ext = (post.fileExt || '').toLowerCase();
  if (['mp4', 'webm', 'mov', 'm4v', 'm3u8'].includes(ext)) return true;
  const src = (post.originalUrl || post.sampleUrl || '').split('?')[0].toLowerCase();
  return /\.(mp4|webm|mov|m4v|m3u8)$/.test(src);
}

/**
 * Resolves full-resolution playable video files from an XHamster video link.
 * (mp4 + HLS, priority: high → low → hls).
 */
export async function resolveXHamsterVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ high: string; low: string; hls: string } | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;
  if (signal?.aborted) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await proxyService.fetchWithFallback(post.sourceLink, {
      headers: {
        'User-Agent': XHAMSTER_UA,
        Referer: `${XHAMSTER_BASE}/`,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
    });
    if (!response.ok) return null;
    const html = await response.text();
    const files = parseXhamsterDetail(html);
    if (!files.high && !files.low && !files.hls) return null;
    return files;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Resolves playable HLS streams from a Pornhub video link
 * (mediaDefinitions: high → hls → low).
 * Stream URLs carry expiring tokens; deliberately NOT cached —
 * resolved fresh on every viewer open.
 */
export async function resolvePornhubVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ high: string; low: string; hls: string } | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;
  if (signal?.aborted) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const headers = {
    'User-Agent': PORNHUB_UA,
    Referer: `${PORNHUB_BASE}/`,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    Cookie: 'accessAgeDisclaimerPH=1; accessPH=1;',
  };

  // 1) Light embed page first (when a viewkey exists), 2) full watch page.
  // Embed is hundreds of KB smaller: cheaper download + parse, so the
  // video starts earlier. Falls back to watch when embed has no mediaDefinitions.
  const urls: string[] = [];
  const keyM = post.sourceLink.match(/viewkey=([a-z0-9]+)/i);
  if (keyM && keyM[1]) urls.push(`${PORNHUB_BASE}/embed/${keyM[1]}`);
  urls.push(post.sourceLink);

  try {
    for (const pageUrl of urls) {
      const response = await proxyService.fetchWithFallback(pageUrl, { headers, signal: ctrl.signal });
      if (!response.ok) continue;
      const html = await response.text();
      const files = parsePornhubDetail(html);
      if (files.high || files.low || files.hls) {
        return files;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Normalizes Realbooru file URLs (the detail page emits `//images/`
 * with a double slash; both forms serve, single slash is canonical).
 */
export function normalizeRealbooruFileUrl(url: string | undefined): string {
  if (!url || typeof url !== 'string') return '';
  return url
    .replace(/&amp;/g, '&')
    .trim()
    .replace(/^\/\//, 'https://')
    .replace(/^(https?:\/\/[^/]+)\/{2,}/, '$1/');
}

/**
 * Extracts playable video files from a Realbooru post detail page.
 * The listing carries no file extension (video-ness comes from tags),
 * so the list scraper guesses `.mp4` — but some posts are webm-only.
 * The detail `<video><source>` tags carry the real files (mp4 preferred).
 * GIF posts have no `<video>` tag; their full file comes from the detail
 * `<img>` instead (`image`).
 */
export function parseRealbooruDetail(html: string): { mp4: string; webm: string; image: string } {
  const out = { mp4: '', webm: '', image: '' };
  if (!html) return out;
  const sourceRe = /<source\s+[^>]*src="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = sourceRe.exec(html)) !== null) {
    const raw = normalizeRealbooruFileUrl(m[1]);
    if (!raw) continue;
    const clean = raw.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp4') && !out.mp4) out.mp4 = raw;
    else if (clean.endsWith('.webm') && !out.webm) out.webm = raw;
    if (out.mp4 && out.webm) break;
  }
  if (!out.mp4 && !out.webm) {
    const imgRe = /<img[^>]+src="([^"]*\/images\/[^"]+)"[^>]*>/gi;
    while ((m = imgRe.exec(html)) !== null) {
      const raw = normalizeRealbooruFileUrl(m[1]);
      if (!raw) continue;
      const clean = raw.split('?')[0].toLowerCase();
      if (/\.(gif|jpe?g|png|webp)$/.test(clean)) {
        out.image = raw;
        break;
      }
    }
  }
  return out;
}

/** mp4 first, then webm, then the full-size image (GIF posts). */
export function selectRealbooruPlayable(files: { mp4: string; webm: string; image: string } | null | undefined): string {
  if (!files) return '';
  return files.mp4 || files.webm || files.image || '';
}

/**
 * Resolves the real playable file for a Realbooru video post from its
 * detail page. File URLs are permanent (no expiring tokens), so results
 * are cached per post for the session.
 */
const REALBOORU_RESOLVE_CACHE = new LruCache<string, { mp4: string; webm: string; image: string }>(RESOLVE_CACHE_MAX);
const REALBOORU_IN_FLIGHT = new Map<string, Promise<{ mp4: string; webm: string; image: string } | null>>();

export async function resolveRealbooruVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ mp4: string; webm: string; image: string } | null> {
  const detailUrl = post.sourceLink?.replace(/&amp;/gi, '&');
  if (!detailUrl || !/^https?:\/\//i.test(detailUrl) || signal?.aborted) return null;
  const cacheKey = detailUrl;
  if (REALBOORU_RESOLVE_CACHE.has(cacheKey)) {
    return REALBOORU_RESOLVE_CACHE.get(cacheKey) ?? null;
  }

  return getOrDedup(REALBOORU_IN_FLIGHT, cacheKey, async () => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    const abort = () => ctrl.abort();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await proxyService.fetchWithFallback(detailUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          Referer: 'https://realbooru.com/',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: ctrl.signal,
      });
      if (!response.ok) {
        return null;
      }
      const files = parseRealbooruDetail(await response.text());
      if (ctrl.signal.aborted) return null;
      if (!files.mp4 && !files.webm && !files.image) {
        return null;
      }
      REALBOORU_RESOLVE_CACHE.set(cacheKey, files);
      return files;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  });
}

/** Known video/archive formats cannot be prefetched or rendered as an image. */
export function isImageMediaUrl(url: string | undefined): boolean {
  return !!url && !isUnsupportedOnIOS(url)
    && !urlEndsWith(url, '.mp4', '.webm', '.mov', '.m4v', '.m3u8', '.mpd', '.zip');
}

/**
 * Returns playable video candidate URLs extracted from post.originalUrl and post.sampleUrl,
 * sorted with iOS-compatible formats (.mp4, .mov, .m4v) first, HLS (.m3u8) next,
 * .webm last. Only returns video URLs; image URLs are excluded.
 */
export function getVideoCandidates(
  post: { originalUrl?: string; sampleUrl?: string; [key: string]: any } | null | undefined
): string[] {
  if (!post) return [];

  const rawUrls: string[] = [];
  if (post.sampleUrl && typeof post.sampleUrl === 'string') rawUrls.push(post.sampleUrl);
  if (post.originalUrl && typeof post.originalUrl === 'string') rawUrls.push(post.originalUrl);

  const seen = new Set<string>();
  const uniqueUrls: string[] = [];
  for (const raw of rawUrls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = normalizeBooruMediaUrl(trimmed);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueUrls.push(normalized);
    }
  }

  const isVideoUrl = (url: string) => {
    const clean = url.split('?')[0].toLowerCase();
    return (
      clean.endsWith('.mp4') ||
      clean.endsWith('.mov') ||
      clean.endsWith('.m4v') ||
      clean.endsWith('.webm') ||
      clean.endsWith('.m3u8')
    );
  };

  const videoUrls = uniqueUrls.filter(isVideoUrl);

  // Saved/imported favorite video posts sometimes only store the thumbnail JPEG URL
  // (e.g. .../thumbnails/ab/cd/thumbnail_<hash>.jpg) with fileExt="webm"/"mp4".
  // Derive the canonical /images/ab/cd/<hash>.<ext> candidate so the viewer can
  // probe the MP4 upgrade or play the WebM fallback instead of seeing 0 video candidates.
  if (videoUrls.length === 0 && isVideoPost(post as any)) {
    for (const u of uniqueUrls) {
      const m = u.match(/^(https?:\/\/[^/]+)\/(?:thumbnails|samples)\/([a-f0-9]{2})\/([a-f0-9]{2})\/(?:thumbnail_|sample_)?([a-f0-9]{16,64})\.[a-z0-9]+/i);
      if (m) {
        const [, origin, d1, d2, hash] = m;
        const ext = typeof post.fileExt === 'string' && post.fileExt.toLowerCase() === 'webm' ? 'webm' : 'mp4';
        videoUrls.push(`${origin}/images/${d1}/${d2}/${hash}.${ext}`);
        break;
      }
    }
  }

  const getPriority = (url: string) => {
    const clean = url.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v')) {
      return 3;
    }
    if (clean.endsWith('.m3u8')) {
      return 2;
    }
    if (clean.endsWith('.webm')) {
      return 1;
    }
    return 0;
  };

  return videoUrls.sort((a, b) => getPriority(b) - getPriority(a));
}

/**
 * Primary playable-candidate selection (single source for viewer + tests).
 * The resolved original URL wins BUT is skipped when iOS can't open its
 * format (e.g. WebM) — otherwise the guard would see a playable candidate
 * in the list and pass while an unsupported URL reaches the player
 * (AVFoundation -11828). Returns webm when nothing is supported; the
 * caller's webm-guard + mp4-upgrade flow takes over.
 */
export function selectPrimaryVideoCandidate(
  resolvedOriginalUrl: string | null | undefined,
  videoCandidates: string[],
  fallbackUrl: string
): string {
  const usable =
    resolvedOriginalUrl &&
    !(Platform.OS === 'ios' && isUnsupportedOnIOS(resolvedOriginalUrl))
      ? resolvedOriginalUrl
      : '';
  return usable || (videoCandidates.length > 0 ? videoCandidates[0] : fallbackUrl);
}

/**
 * Converts a .webm media URL to a corresponding .mp4 URL while preserving query strings and hashes.
 * Returns null if the URL does not have a .webm extension or is invalid.
 */
export function getMp4UpgradeUrl(webmUrl: string | undefined): string | null {
  if (!webmUrl || typeof webmUrl !== 'string') return null;
  let candidate = webmUrl.trim();
  if (!candidate) return null;

  // Unwrap proxy Worker URL if the saved favorite stored a proxied URL
  try {
    const parsed = new URL(candidate);
    const wrapped = parsed.searchParams.get('url');
    if (wrapped && /^https?:\/\//i.test(wrapped)) {
      candidate = wrapped.trim();
    }
  } catch {}

  candidate = normalizeBooruMediaUrl(candidate) || candidate;

  const match = candidate.match(/^([^?#]+)\.webm([?#].*)?$/i);
  if (match) {
    const base = match[1];
    const queryOrHash = match[2] || '';
    return `${base}.mp4${queryOrHash}`;
  }

  // Also derive /images/ab/cd/<hash>.mp4 when a saved favorite only has a thumbnail/sample image URL
  const thumbMatch = candidate.match(
    /^(https?:\/\/[^/]+)\/(?:thumbnails|samples)\/([a-f0-9]{2})\/([a-f0-9]{2})\/(?:thumbnail_|sample_)?([a-f0-9]{16,64})\.[a-z0-9]+([?#].*)?$/i
  );
  if (thumbMatch) {
    const [, origin, d1, d2, hash, queryOrHash = ''] = thumbMatch;
    return `${origin}/images/${d1}/${d2}/${hash}.mp4${queryOrHash}`;
  }

  return null;
}

const mp4UpgradeCache = new LruCache<string, string | null>(RESOLVE_CACHE_MAX);
const mp4UpgradeInFlight = new Map<string, Promise<string | null>>();

/** Clears all in-memory media resolve caches (dims, original URLs, Realbooru, MP4 upgrades). */
export function clearResolveCaches(): void {
  DIMS_CACHE.clear();
  ORIGINAL_RESOLVE_CACHE.clear();
  REALBOORU_RESOLVE_CACHE.clear();
  mp4UpgradeCache.clear();
}

/**
 * Checks via a HEAD request whether an .mp4 version of a .webm video is available.
 * Attaches proxy headers via getMediaHeaders.
 * Returns the mp4 URL if HTTP status is 200-299, otherwise null.
 * Results are cached in bounded LRU memory (negative results expire after 60s).
 */
export async function checkMp4UpgradeAvailable(
  webmUrl: string | undefined,
  timeoutMs: number = 6000
): Promise<string | null> {
  if (!webmUrl || typeof webmUrl !== 'string') return null;
  const trimmed = webmUrl.trim();
  if (!trimmed) return null;

  const mp4Url = getMp4UpgradeUrl(trimmed);
  if (!mp4Url) return null;

  if (mp4UpgradeCache.has(trimmed)) {
    return mp4UpgradeCache.get(trimmed) ?? null;
  }

  return getOrDedup(mp4UpgradeInFlight, trimmed, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const targetUrl = getMediaUrl(mp4Url);
      const headers = getMediaHeaders(mp4Url);

      // Selective fallback fetch instead of a direct HEAD: on a TLS-fragile
      // host, retry once via the registered worker if the direct leg breaks.
      const response = await proxyService.fetchWithFallback(targetUrl, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });

      if (response.status >= 200 && response.status < 300) {
        mp4UpgradeCache.set(trimmed, mp4Url);
        return mp4Url;
      }

      // Some booru CDNs/relays reject HEAD (403/405) even when the MP4 exists;
      // probe the first 64 bytes via GET Range before giving up.
      if (response.status !== 404 && !controller.signal.aborted) {
        const rangeRes = await proxyService.fetchWithFallback(targetUrl, {
          method: 'GET',
          headers: { ...headers, Range: 'bytes=0-63' },
          signal: controller.signal,
        });
        if (rangeRes.status >= 200 && rangeRes.status < 300) {
          mp4UpgradeCache.set(trimmed, mp4Url);
          return mp4Url;
        }
      }

      mp4UpgradeCache.set(trimmed, null, NEGATIVE_RESOLVE_TTL_MS);
      return null;
    } catch {
      mp4UpgradeCache.set(trimmed, null, NEGATIVE_RESOLVE_TTL_MS);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

