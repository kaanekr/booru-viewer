import { Platform } from 'react-native';
import { proxyService } from '../services/proxyService';
import { ImageQuality } from '../services/storage';
import { parseXVideosFiles, XVIDEOS_BASE, XVIDEOS_UA } from '../services/xvideos';
import { parseXhamsterDetail, XHAMSTER_BASE, XHAMSTER_UA } from '../services/xhamster';
import { parsePornhubDetail, PORNHUB_BASE, PORNHUB_UA } from '../services/pornhub';

const DIMS_CACHE = new Map<string, { w: number; h: number; bytes?: number }>();

/**
 * Post sayfasındaki orijinal görsel linkinden gerçek ölçüleri çözer.
 * Gelbooru liste HTML'inde boyut bilgisi yoktur (scrape 800x1000 placeholder
 * bırakır); Info modalı bu fonksiyonla gerçek WxH'yi doldurur.
 * Sonuçlar oturum boyunca cache'lenir, aynı post iki kez fetch edilmez.
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
  const cacheKey = post.id || post.originalUrl || '';
  if (cacheKey && DIMS_CACHE.has(cacheKey)) return DIMS_CACHE.get(cacheKey)!;
  const pageUrl = post.sourceLink;
  if (!pageUrl || typeof pageUrl !== 'string' || !/^https?:\/\//i.test(pageUrl)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await proxyService.fetchWithFallback(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    // Dosya boyutu: post sayfasındaki orijinal linkin yanında yazar
    // (örn. "2.4 MB", "850 KB", "1,234,567 bytes")
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

    // Gelbooru gibi sitelerde post sayfasında dosya boyutu metin olarak bulunmayabilir;
    // Orijinal görsel URL'ine hafif bir HEAD isteği atarak Content-Length'i alıyoruz
    if (!foundBytes && (post.originalUrl || post.sampleUrl)) {
      try {
        const rawMediaUrl = post.originalUrl || post.sampleUrl;
        const headers = getMediaHeaders(rawMediaUrl);
        const headCtrl = new AbortController();
        const headTimeout = setTimeout(() => headCtrl.abort(), 4000);
        const headRes = await proxyService.fetchWithFallback(rawMediaUrl as string, {
          method: 'HEAD',
          headers,
          signal: headCtrl.signal,
        });
        clearTimeout(headTimeout);
        const cl = headRes.headers.get('content-length');
        if (cl) {
          const parsed = parseInt(cl, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            foundBytes = parsed;
          }
        }
      } catch {
        // HEAD fallback opsiyoneldir, hata fırlatmaz
      }
    }

    // 1) Orijinal link: .../images/<d1>/<d2>/<hash>.<ext> — boyut post sayfasında
    //    "Size: 1456 x 2048" / "1456x2048" / image width/height attribute'ları
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
    // 2) Fallback: sayfadaki ana görselin width/height attribute'u
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
  if (!url) return '';
  let u = url.trim();
  if (u.startsWith('//')) u = 'https:' + u;

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

  return u;
}

/**
 * Gets the ready-to-load media URL. Global toggle açıksa tüm trafik Worker
 * üzerinden geçer; toggle kapalıysa sadece TLS-kırılgan host'lar
 * (örn. api-cdn-mp4.rule34.xxx) worker kayıtlıysa seçici proxy'lenir.
 */
export function getMediaUrl(url: string | undefined): string {
  if (!url) return '';
  const normalized = normalizeBooruMediaUrl(url);
  return proxyService.proxyUrl(normalized);
}

/**
 * Returns an expo-image compatible source object with distinct cacheKey per decode policy
 * (e.g. grid downscaled vs full original un-downscaled).
 */
export function getMediaSource(
  rawUrl: string | undefined,
  purpose: 'grid' | 'sample' | 'full' = 'sample'
): { uri: string; headers: Record<string, string>; cacheKey: string } | null {
  if (!rawUrl) return null;
  const url = getMediaUrl(rawUrl);
  if (!url) return null;
  return {
    uri: url,
    headers: getMediaHeaders(url),
    cacheKey: `${url}:${purpose}`,
  };
}

/**
 * Gelbooru/Realbooru scrape sonucunda liste küçük resmi üzerinden orijinal
 * görsel uzantısı tahmin edilemez (.jpg/.jpeg/.png/.webp CDN'e göre değişir).
 * Gerçek original URL'yi post detay sayfasından çözer (cache'li, abortable).
 */
const ORIGINAL_RESOLVE_CACHE = new Map<string, string | null>();

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
  // Eğer post zaten geçerli ve sample'dan farklı bir originalUrl'e sahipse fetch etme
  if (post.originalUrl && post.originalUrl !== post.sampleUrl) {
    return post.originalUrl;
  }
  if (!post.sourceLink) return post.originalUrl || null;

  const cacheKey = post.sourceLink;
  if (ORIGINAL_RESOLVE_CACHE.has(cacheKey)) {
    return ORIGINAL_RESOLVE_CACHE.get(cacheKey) ?? null;
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  if (signal) {
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const response = await proxyService.fetchWithFallback(post.sourceLink, {
      headers: getMediaHeaders(post.sourceLink),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Post view status ${response.status}`);
    const html = await response.text();

    // 1) "Original image" veya "View larger size" bağlantısını ara
    const originalLinkMatch =
      html.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(?:Original image|View larger size|High resolution)<\/a>/i) ||
      html.match(/<a\s+[^>]*href=["']([^"']+\/images\/[^"']+)["']/i);

    let resolved: string | null = null;
    if (originalLinkMatch && originalLinkMatch[1]) {
      resolved = originalLinkMatch[1].replace(/&amp;/g, '&').trim();
    }

    // 2) Sayfadaki /images/ dosya yollarını tara
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
        const baseMatch = post.sourceLink.match(/^https?:\/\/[^/]+/i);
        const base = baseMatch ? baseMatch[0] : 'https://gelbooru.com';
        resolved = `${base}${resolved}`;
      }
      ORIGINAL_RESOLVE_CACHE.set(cacheKey, resolved);
      return resolved;
    }

    ORIGINAL_RESOLVE_CACHE.set(cacheKey, null);
    return null;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      return null;
    }
    ORIGINAL_RESOLVE_CACHE.set(cacheKey, null);
    return null;
  }
}

/**
 * Generates the correct User-Agent and Referer headers required by each Booru server.
 */
export function getMediaHeaders(url: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  };
  if (!url) return headers;

  const target = decodeURIComponent(url);

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
  return clean.endsWith('.webm') || clean.includes('.webm');
}

/**
 * XVideos detay sayfasından oynatılabilir video URL'lerini çözer
 * (setVideoUrlHigh/Low mp4 + HLS, öncelik: high → low → hls).
 * mp4 URL'leri süreli secure-token taşır; BİLİNÇLİ olarak cache'lenmez —
 * her viewer açılışında taze çözülür.
 */
export async function resolveXVideosVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ high: string; low: string; hls: string } | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  if (signal) {
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const response = await proxyService.fetchWithFallback(post.sourceLink, {
      headers: {
        'User-Agent': XVIDEOS_UA,
        Referer: `${XVIDEOS_BASE}/`,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    const files = parseXVideosFiles(html);
    if (!files.high && !files.low && !files.hls) return null;
    return files;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * XHamster video linkinden tam çözünürlüklü oynatılabilir video dosyalarını çözer.
 * (mp4 + HLS, öncelik: high → low → hls).
 */
export async function resolveXHamsterVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ high: string; low: string; hls: string } | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  if (signal) {
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const response = await proxyService.fetchWithFallback(post.sourceLink, {
      headers: {
        'User-Agent': XHAMSTER_UA,
        Referer: `${XHAMSTER_BASE}/`,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    const files = parseXhamsterDetail(html);
    if (!files.high && !files.low && !files.hls) return null;
    return files;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Pornhub video linkinden oynatılabilir HLS akışlarını çözer
 * (mediaDefinitions: high → hls → low).
 * Akış URL'leri süreli token taşır; BİLİNÇLİ olarak cache'lenmez —
 * her viewer açılışında taze çözülür.
 */
export async function resolvePornhubVideoUrls(
  post: {
    id?: string;
    sourceLink?: string;
  },
  signal?: AbortSignal
): Promise<{ high: string; low: string; hls: string } | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  if (signal) {
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const headers = {
    'User-Agent': PORNHUB_UA,
    Referer: `${PORNHUB_BASE}/`,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    Cookie: 'accessAgeDisclaimerPH=1; accessPH=1;',
  };

  // 1) Tam izleme sayfası, 2) hafif embed sayfası (viewkey gerekir)
  const urls = [post.sourceLink];
  const keyM = post.sourceLink.match(/viewkey=([a-z0-9]+)/i);
  if (keyM && keyM[1]) urls.push(`${PORNHUB_BASE}/embed/${keyM[1]}`);

  try {
    for (const pageUrl of urls) {
      const response = await proxyService.fetchWithFallback(pageUrl, { headers, signal: ctrl.signal });
      if (!response.ok) continue;
      const html = await response.text();
      const files = parsePornhubDetail(html);
      if (files.high || files.low || files.hls) {
        clearTimeout(timeout);
        return files;
      }
    }
    clearTimeout(timeout);
    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
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
 * Converts a .webm media URL to a corresponding .mp4 URL while preserving query strings and hashes.
 * Returns null if the URL does not have a .webm extension or is invalid.
 */
export function getMp4UpgradeUrl(webmUrl: string | undefined): string | null {
  if (!webmUrl || typeof webmUrl !== 'string') return null;
  const trimmed = webmUrl.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([^?#]+)\.webm([?#].*)?$/i);
  if (!match) return null;

  const base = match[1];
  const queryOrHash = match[2] || '';
  return `${base}.mp4${queryOrHash}`;
}

const mp4UpgradeCache = new Map<string, Promise<string | null>>();

/**
 * Checks via a HEAD request whether an .mp4 version of a .webm video is available.
 * Attaches proxy headers via getMediaHeaders.
 * Returns the mp4 URL if HTTP status is 200-299, otherwise null.
 * Results are cached in memory so the same URL is never checked twice.
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

  const cached = mp4UpgradeCache.get(trimmed);
  if (cached) {
    return cached;
  }

  const checkPromise = (async (): Promise<string | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const targetUrl = getMediaUrl(mp4Url);
      const headers = getMediaHeaders(mp4Url);

      // Direkt HEAD yerine seçici fallback'li fetch: TLS-kırılgan host'ta
      // direkt koparsa kayıtlı worker üzerinden tek seferlik tekrar dener.
      const response = await proxyService.fetchWithFallback(targetUrl, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });

      if (response.status >= 200 && response.status < 300) {
        return mp4Url;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  mp4UpgradeCache.set(trimmed, checkPromise);
  return checkPromise;
}

