import { Platform } from 'react-native';
import { proxyService } from '../services/proxyService';

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
