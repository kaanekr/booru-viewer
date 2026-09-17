import { Platform } from 'react-native';
import { proxyService } from '../services/proxyService';
import { ImageQuality } from '../services/storage';

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
): { displayUri: string; placeholderUri: string; fullUri: string } {
  if (!post) {
    return { displayUri: '', placeholderUri: '', fullUri: '' };
  }

  const preview = post.previewUrl || '';
  const sample = post.sampleUrl || post.originalUrl || '';
  const full = post.originalUrl || post.sampleUrl || '';

  const display = quality === 'full' ? full : sample;
  const placeholder = preview || sample;

  return {
    displayUri: display,
    placeholderUri: placeholder,
    fullUri: full,
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
 * Gets the ready-to-load media URL, routing through Cloudflare Worker proxy if enabled.
 */
export function getMediaUrl(url: string | undefined): string {
  if (!url) return '';
  const normalized = normalizeBooruMediaUrl(url);
  return proxyService.proxyUrl(normalized);
}

/**
 * Generates the correct User-Agent and Referer headers required by each Booru server.
 */
export function getMediaHeaders(url: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'AnimeBoxes/1.9.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
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
  } else if (target.includes('safebooru.org')) {
    headers['Referer'] = 'https://safebooru.org/';
  } else if (target.includes('yande.re')) {
    headers['Referer'] = 'https://yande.re/';
  } else if (target.includes('konachan.net')) {
    headers['Referer'] = 'https://konachan.net/';
  } else if (target.includes('cum.st') || target.includes('coomer.st')) {
    headers['Referer'] = 'https://cum.st/';
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
 * Returns playable video candidate URLs extracted from post.originalUrl and post.sampleUrl,
 * sorted with iOS-compatible formats (.mp4, .mov, .m4v) prioritized ahead of .webm.
 * Only returns video extension URLs (.mp4, .mov, .m4v, .webm); image URLs are excluded.
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
      clean.endsWith('.webm')
    );
  };

  const videoUrls = uniqueUrls.filter(isVideoUrl);

  const getPriority = (url: string) => {
    const clean = url.split('?')[0].toLowerCase();
    if (clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v')) {
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

      const response = await fetch(targetUrl, {
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

