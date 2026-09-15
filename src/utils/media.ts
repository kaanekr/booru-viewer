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
