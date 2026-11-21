import type { BooruPost, BooruSource } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * Sex.com (https://www.sex.com) integration - pure helpers.
 * Next.js SSR: list cards are data-testid video-card nodes.
 * - Discover: GET /en/videos (page 1), /en/videos?page=N (N>=2)
 * - Search: GET /en/videos?search=<word> (page 1), /en/videos?page=N&search=<word>
 * - No sort parameter; cards carry preview mp4 + duration/views/channel.
 * - Detail: JSON-LD VideoObject -> contentUrl (HLS m3u8) + thumbnailUrl.
 * No React import - can be tested directly with node.
 */

export const SEXCOM_BASE = 'https://www.sex.com';

/** iPhone UA for search/list HTML (the site's mobile variant returns the same markup). */
export const SEXCOM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

export function buildSexComSearchCandidates(baseUrl: string, page: number, keyword: string): string[] {
  const base = (baseUrl || SEXCOM_BASE).replace(/\/$/, '');
  const k = (keyword || '').trim();
  if (!k) {
    if (page <= 1) return [base + '/en/videos'];
    return [base + '/en/videos?page=' + page];
  }
  const q = encodeURIComponent(k);
  if (page <= 1) return [base + '/en/videos?search=' + q];
  return [base + '/en/videos?page=' + page + '&search=' + q];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Converts a '<1K' / '2.4M' / '850' style view text into a number (for badge/sorting). */
export function parseSexComViewsCount(raw: string | undefined): number {
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
 * Extracts cards from list/search HTML. Each card is one video:
 * static cover (images.sxccdn.com ... thumbnail.N.jpg.webp) + hover preview
 * mp4 (videos*.sex.com ... preview_240p.mp4) + duration + channel + views.
 */
export function parseSexComListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!html) return posts;
  const seen = new Set<string>();
  const base = (source.baseUrl || SEXCOM_BASE).replace(/\/$/, '');

  const chunks = html.split('data-testid="video-card"');
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];

    const idM = c.match(/data-analytics-video_id="(\d+)"/);
    if (!idM) continue;
    const videoId = idM[1];
    if (seen.has(videoId)) continue;

    const hrefM = c.match(/href="(\/en\/videos\/\d+[^"]*)"/);
    if (!hrefM) continue;

    const titleM =
      c.match(/data-title="([^"]+)"/) ||
      c.match(/<img[^>]*alt="([^"]+)"/i) ||
      c.match(/title="([^"]+)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';

    const thumbM = c.match(/src="(https:\/\/images\.sxccdn\.com\/videos\/\d+\/\d+\/(?:thumbnail\.[^"]+|poster\.webp))"/);
    const thumb = thumbM ? thumbM[1].trim() : '';
    const pvM = c.match(/<video[^>]*src="([^"]+)"/i);
    const previewVideo = pvM ? decodeEntities(pvM[1]).trim() : undefined;
    if (!thumb && !previewVideo) continue;

    const durM = c.match(/<time>([^<]*)<\/time>/i);
    const duration = durM ? decodeEntities(durM[1]).trim() : '';
    const chM = c.match(/data-testid="video-link-to-source-channel"[^>]*>([^<]+)</i);
    const channel = chM ? decodeEntities(chM[1]).trim() : '';
    const viewsM = c.match(/data-testid="view-count"[\s\S]{0,800}?<span>([^<]*)<\/span>/i);
    const viewsRaw = viewsM ? decodeEntities(viewsM[1]).trim() : '';
    const rateM = c.match(/>([0-9]{1,3})%<\/span>/);
    const ratingPct = rateM ? rateM[1] : '';
    // Premium marker on the card's video tag (if absent, unknown -> included).
    const premiumM = c.match(/data-premium="([01])"/);
    const isPremium = premiumM ? premiumM[1] === '1' : false;

    const score = parseSexComViewsCount(viewsRaw);
    const artist = channel ? [channel] : [];
    const general: string[] = [];
    if (duration) general.push('duration:' + duration);
    if (viewsRaw) general.push('views:' + viewsRaw);
    if (ratingPct) general.push('rating:' + ratingPct + '%');

    seen.add(videoId);
    posts.push({
      id: 'sx_' + videoId,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: thumb || previewVideo || '',
      previewVideoUrl: previewVideo,
      previewThumbUrl: undefined,
      previewThumbs: undefined,
      sampleUrl: previewVideo || thumb,
      // The full file may be time-limited; not embedded at list time - freshly resolved from detail when the viewer opens.
      originalUrl: '',
      width: 1280,
      height: 720,
      aspectRatio: 16 / 9,
      rating: 'e',
      score,
      favCount: score,
      tags: {
        artist,
        character: [],
        copyright: [],
        general,
        meta: ['video'],
      },
      allTags: [...artist],
      sourceLink: base + decodeEntities(hrefM[1]),
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
      isPremium,
    });
  }

  return posts;
}

export interface SexComFiles {
  hls: string;
  mp4: string;
  thumb: string;
  /** True when contentUrl sits on a premium-locked host (premium-*): the anonymous player cannot open it. */
  premium: boolean;
  title?: string;
  durationSec?: number;
}

/** Converts a 'P0Y0M0DT0H0M601S' style ISO8601 duration into seconds. */
export function parseSexComISODuration(raw: string | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

/**
 * Extracts playable files from video detail HTML:
 * JSON-LD VideoObject contentUrl (HLS m3u8) + thumbnailUrl; the page's video
 * tag mp4 as fallback. HLS plays natively on iOS.
 */
export function parseSexComDetail(html: string): SexComFiles {
  const out: SexComFiles = { hls: '', mp4: '', thumb: '', premium: false };
  if (!html) return out;
  const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  const scope = ldM ? ldM[1] : html;

  const hlsM = scope.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
  if (hlsM) {
    const cu = hlsM[1].trim();
    const base = cu.split('?')[0];
    if (/\.m3u8$/i.test(base)) {
      out.hls = cu;
      const hostM = cu.match(/^https?:\/\/([^/]+)/i);
      out.premium = !!hostM && /^premium-/i.test(hostM[1]);
    } else if (/\.mp4$/i.test(base) && !out.mp4) {
      out.mp4 = cu;
    }
  }
  const thM = scope.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (thM) out.thumb = thM[1].trim();
  const nameM = scope.match(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (nameM) {
    try {
      out.title = JSON.parse('"' + nameM[1] + '"');
    } catch {
      out.title = decodeEntities(nameM[1]);
    }
  }
  const durM = scope.match(/"duration"\s*:\s*"([^"]+)"/i);
  if (durM) {
    const secs = parseSexComISODuration(durM[1]);
    if (secs) out.durationSec = secs;
  }

  const mp4M = html.match(/<video[^>]*src="([^"]+\.mp4[^"]*)"/i);
  if (mp4M && !out.mp4) out.mp4 = decodeEntities(mp4M[1]).trim();
  return out;
}

/**
 * Removes premium-locked posts from the list. On sex.com, videos without a
 * served full file never enter the grid; the rest are free for the viewer,
 * and if a preview stalls the cause is a resolution/TLS error (visible in logs).
 */
export function excludePremiumPosts<T extends { isPremium?: boolean }>(posts: T[]): T[] {
  if (!posts) return posts;
  return posts.filter((p) => !p || !p.isPremium);
}

/**
 * Playable URL selection for the viewer (single source for viewer + tests):
 * premium-locked HLS does not open in the anonymous player; if present, the preview mp4
 * plays (better than an error card). Normally HLS, else mp4.
 */
export function selectSexComPlayable(files: SexComFiles | null): string | null {
  if (!files) return null;
  if (files.premium) return files.mp4 || null;
  return files.hls || files.mp4 || null;
}

/**
 * Resolves fresh playable URLs from the video detail page.
 * Stream URLs may be time-limited; DELIBERATELY not cached -
 * freshly resolved on every viewer open.
 */
export async function resolveSexComVideoUrls(
  post: { sourceLink?: string },
  signal?: AbortSignal
): Promise<SexComFiles | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;
  if (signal?.aborted) return null;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // If the direct link breaks (TLS -1200 / bot wall), a registered worker is tried
    // once if one exists; without a worker there is no way past the direct link.
    const response = await proxyService.fetchWithFallback(
      post.sourceLink,
      {
        headers: {
          'User-Agent': SEXCOM_UA,
          Referer: SEXCOM_BASE + '/',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: ctrl.signal,
      },
      10000
    );
    if (!response.ok) return null;
    const html = await response.text();
    const files = parseSexComDetail(html);
    if (!files.hls && !files.mp4) return null;
    return files;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}
