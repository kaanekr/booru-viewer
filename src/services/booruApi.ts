import { BooruPost, BooruSource, BooruTagGroups, BooruTagSuggestion, RedGifsNiche, RedGifsTrendingTag, TagCategory, SearchFilterConfig } from '../types/booru';
import { asTagList } from '../utils/guards';
import { LruCache } from '../utils/lruCache';
import { DEFAULT_SOURCE } from './sources';
import { proxyService } from './proxyService';
import { StorageService } from './storage';
import {
  buildXVideosSearchCandidates,
  buildXVideosSearchUrl,
  extractXVideosBestMonth,
  parseXVideosListing,
  xvideosDatefForTimeRange,
  XVIDEOS_BASE,
  XVIDEOS_UA,
} from './xvideos';
import type { XVideosDatef, XVideosSort } from './xvideos';
import {
  buildXhamsterSearchCandidates,
  buildXhamsterSearchUrl,
  parseXhamsterListing,
  xhamsterDateForTimeRange,
  XHAMSTER_BASE,
  XHAMSTER_UA,
} from './xhamster';
import type { XHamsterDate, XHamsterSort } from './xhamster';
import {
  buildPornhubSearchUrl,
  mapPornhubVideoToPost,
  parsePornhubHtmlListing,
  pornhubPeriodForTimeRange,
  PORNHUB_BASE,
  PORNHUB_UA,
} from './pornhub';
import type { PornhubOrdering, PornhubVideo } from './pornhub';
import {
  buildSexComSearchCandidates,
  parseSexComListing,
  excludePremiumPosts,
  SEXCOM_BASE,
  SEXCOM_UA,
} from './sexcom';
import {
  buildHentaiHavenSearchCandidates,
  parseHentaiHavenListing,
  fetchHentaiHavenPosts as fetchHHPostsService,
  searchHentaiHavenTags,
  HENTAIHAVEN_BASE,
  HENTAIHAVEN_UA,
} from './hentaihavens';
import {
  buildNHentaiApiCandidates,
  nhentaiApiHeaders,
  nhentaiApiSort,
  parseNHentaiV2Listing,
  searchNHentaiTags,
  NHENTAI_API_UA,
} from './nhentai';

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const RULE34_AUTH_ERROR = 'Rule34 requires your own API key and user_id. Set them in Settings → Sources → Rule34.xxx → Account & API (rule34.xxx/index.php?page=account&s=options).';

/** UI/booru tag labels use underscores; RedGifs search text uses spaces. */
function redGifsSearchText(value: string): string {
  return value.replace(/[_\s]+/g, ' ').trim();
}

/**
 * Hard timeout not tied to Abort: an aborted fetch may hang in release builds,
 * so this race always settles the promise (a dangling request stays pending).
 */
function withHardTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let rt: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    rt = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([p.then((v) => { if (rt) clearTimeout(rt); return v; }, (e) => { if (rt) clearTimeout(rt); throw e; }), timeout]);
}

async function fetchBooru(url: string, init?: RequestInit): Promise<Response> {
  return await proxyService.fetchWithFallback(url, init);
}

/** Gelbooru-engine timed popular: cache of the period's first post id (lower bound).
 *  The engine doesn't support date filters, so the bound is found by walking
 *  backwards through recent additions; the real query sorts server-side via `id:>BOUND sort:score:desc`. */
const BOUND_CACHE_TTL_MS = 5 * 60 * 1000;
const gelbooruBoundCache = new LruCache<string, number | null>(100, BOUND_CACHE_TTL_MS);
const BOUND_WALK_LIMIT = 100;
const BOUND_MAX_PAGES = 15;

const CUMST_TAGS_CACHE_TTL_MS = 15 * 60 * 1000;
let cumStTagsCache: { baseUrl: string; tags: any[]; at: number } | null = null;

function mapDanbooruCategory(catNum: number): TagCategory {
  switch (catNum) {
    case 1:
      return 'artist';
    case 3:
      return 'copyright';
    case 4:
      return 'character';
    case 5:
      return 'meta';
    default:
      return 'general';
  }
}

function ensureAbsoluteUrl(url: string | undefined, baseUrl: string): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  } else if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  } else {
    return `${baseUrl.replace(/\/$/, '')}/${trimmed.replace(/^\//, '')}`;
  }
}

function normalizeRating(rawRating: string | undefined): 's' | 'q' | 'e' | 'g' {
  if (!rawRating) return 's';
  const lower = rawRating.toLowerCase();
  if (lower === 'general' || lower === 'g' || lower === 'safe' || lower === 's') return 's';
  if (lower === 'questionable' || lower === 'q') return 'q';
  if (lower === 'explicit' || lower === 'e') return 'e';
  return 's';
}

/** YYYY-MM-DD (for Moebooru date:A..B ranges) */
function formatYMD(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function pastYMD(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatYMD(d);
}

/** TimeRangeOption → day count (0 = unlimited) */
export function timeRangeToDays(timeRange: string | undefined): number {
  if (timeRange === '1d') return 1;
  if (timeRange === '1w') return 7;
  if (timeRange === '1m') return 30;
  if (timeRange === '1y') return 365;
  return 0;
}

/**
 * Leaderboard anchor alignment (cum.st): in weekly/monthly periods snaps the anchor
 * to the start of the calendar period — every day in the same period produces the
 * exact same `date:` query, the period never drifts ("2 days ago + week's leader" ===
 * "this week's leaders"). The server applies the same alignment (verified live:
 * week→Monday, month→the 1st); doing it client-side guarantees the behavior.
 * Daily/period-less ranges pass through untouched. UTC math is used (no
 * timezone shift). Invalid input is returned as-is.
 */
export function snapLeaderboardAnchor(anchorYMD: string | undefined, timeRange: string | undefined): string {
  const clean = (anchorYMD || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  if (timeRange === '1w') {
    const [y, m, d] = clean.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return clean;
    const dt = new Date(Date.UTC(y, m - 1, d));
    // Overflowing days (e.g. Feb 30) silently round — don't corrupt the input, pass it through
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return clean;
    }
    const back = (dt.getUTCDay() + 6) % 7; // Monday=0 … Sunday=6 days back
    dt.setUTCDate(dt.getUTCDate() - back);
    const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
  }
  if (timeRange === '1m') {
    const [, m, d] = clean.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return clean;
    return `${clean.slice(0, 4)}-${clean.slice(5, 7)}-01`;
  }
  return clean;
}

export class BooruApiService {
  private currentSource: BooruSource = DEFAULT_SOURCE;
  private lastRequestAt = new Map<string, number>();
  private requestSlots = new Map<string, Promise<void>>();

  setSource(source: BooruSource) {
    this.currentSource = source;
  }

  getSource(): BooruSource {
    return this.currentSource;
  }

  private reserveRequestSlot(url: string): Promise<void> {
    const origin = new URL(url).origin;
    const slot = (this.requestSlots.get(origin) ?? Promise.resolve()).then(async () => {
      const previous = this.lastRequestAt.get(origin);
      const wait = previous === undefined ? 0 : 800 - (Date.now() - previous);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt.set(origin, Date.now());
    });
    const settled = slot.then(() => {}, () => {});
    this.requestSlots.set(origin, settled);
    void settled.then(() => {
      if (this.requestSlots.get(origin) === settled) this.requestSlots.delete(origin);
    });
    return slot;
  }

  /**
   * Rate-limit protection + 429/5xx retry: at least 800ms between requests
   * so Gelbooru doesn't ban the scraper; on 429/503 it waits once and retries.
   * 403 is also retried (DPI/bot walls drop flows intermittently, the second attempt usually passes).
   */
  private async fetchWithRetry(url: string, init?: RequestInit, retries = 1, timeoutMs = 12000): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      await this.reserveRequestSlot(url);
      const ctrl = new AbortController();
      const callerSignal = init?.signal;
      let timedOut = false;
      const onAbort = () => ctrl.abort();
      callerSignal?.addEventListener('abort', onAbort, { once: true });
      if (callerSignal?.aborted) ctrl.abort();
      const t = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      try {
        if (ctrl.signal.aborted) {
          const error = new Error(timedOut ? `fetch timeout after ${timeoutMs}ms` : 'Request aborted');
          error.name = timedOut ? 'TimeoutError' : 'AbortError';
          throw error;
        }
        return await withHardTimeout(fetchBooru(url, { ...init, signal: ctrl.signal }), timeoutMs, url);
      } catch (err: any) {
        if (timedOut && !callerSignal?.aborted && err?.name === 'AbortError') {
          const timeoutErr = new Error(`fetch timeout after ${timeoutMs}ms`);
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
        throw err;
      } finally {
        clearTimeout(t);
        callerSignal?.removeEventListener('abort', onAbort);
      }
    };
    const res = await attempt();
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && retries > 0) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
      return await attempt();
    }
    return res;
  }

  buildQueryTags(filter: SearchFilterConfig, source?: BooruSource): string {
    const activeSource = source || this.currentSource;
    const parts: string[] = [];

    // Base user tags
    if (filter.tags && filter.tags.length > 0) {
      filter.tags.forEach((t) => {
        const trimmed = t.trim();
        if (trimmed) parts.push(trimmed);
      });
    }

    // Min Score (RedGifs/XVideos/XHamster/Pornhub/Sex.com/HentaiHaven/nhentai have no score filter; sent as a literal tag it would zero out results)
    if (filter.minScore && filter.minScore > 0 && activeSource.type !== 'redgifs' && activeSource.type !== 'xvideos' && activeSource.type !== 'xhamster' && activeSource.type !== 'pornhub' && activeSource.type !== 'sexcom' && activeSource.type !== 'hentaihaven' && activeSource.type !== 'nhentai') {
      parts.push(`score:>=${filter.minScore}`);
    }

    // User / Artist / Creator (RedGifs user search runs on a separate endpoint;
    // XVideos/XHamster/Pornhub have no profile-page search, the username is searched as a plain word)
    if (filter.user && filter.user.trim()) {
      if (activeSource.type === 'cumst') {
        parts.push(`creator:${filter.user.trim()}`);
      } else if (activeSource.type === 'xvideos' || activeSource.type === 'xhamster' || activeSource.type === 'pornhub' || activeSource.type === 'sexcom' || activeSource.type === 'hentaihaven' || activeSource.type === 'nhentai') {
        parts.push(filter.user.trim());
      } else if (activeSource.type !== 'redgifs') {
        parts.push(`user:${filter.user.trim()}`);
      }
    }

    // Cum.st Service Filter (OnlyFans / Fansly)
    if (activeSource.type === 'cumst' && filter.cumstService && filter.cumstService !== 'all') {
      parts.push(`service:${filter.cumstService}`);
    }

    // Cum.st Media Type Filter (Photos / Videos / Audio)
    if (activeSource.type === 'cumst' && filter.cumstMediaType && filter.cumstMediaType !== 'all') {
      parts.push(`type:${filter.cumstMediaType}`);
    }

    // Historical Leaderboard / Anchor Date (cum.st-only; on other engines it
    // counts as a literal tag and zeroes out results). In weekly/monthly periods the anchor
    // snaps to the calendar start: days of the same period produce the same query.
    if (filter.leaderboardDate && activeSource.type !== 'xvideos' && activeSource.type !== 'redgifs' && activeSource.type !== 'xhamster' && activeSource.type !== 'pornhub' && activeSource.type !== 'sexcom' && activeSource.type !== 'hentaihaven' && activeSource.type !== 'nhentai') {
      const anchor =
        activeSource.type === 'cumst'
          ? snapLeaderboardAnchor(filter.leaderboardDate, filter.timeRange)
          : filter.leaderboardDate.trim();
      parts.push(`date:${anchor}`);
    }

    // Rating Filter
    if (filter.rating && filter.rating !== 'all') {
      if (activeSource.type === 'danbooru') {
        const map: Record<string, string> = { safe: 'rating:g', questionable: 'rating:q', explicit: 'rating:e' };
        if (map[filter.rating]) parts.push(map[filter.rating]);
      } else if (activeSource.type === 'moebooru') {
        const map: Record<string, string> = { safe: 'rating:s', questionable: 'rating:q', explicit: 'rating:e' };
        if (map[filter.rating]) parts.push(map[filter.rating]);
      } else if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        const map: Record<string, string> = { safe: activeSource.id === 'gelbooru' ? 'rating:general' : 'rating:safe', questionable: 'rating:questionable', explicit: 'rating:explicit' };
        if (map[filter.rating]) parts.push(map[filter.rating]);
      }
    }

    // Sort By & Time Range (RedGifs/XVideos/XHamster/Pornhub/nhentai ordering is handled inside their own functions)
    if (activeSource.type === 'redgifs' || activeSource.type === 'xvideos' || activeSource.type === 'xhamster' || activeSource.type === 'pornhub' || activeSource.type === 'sexcom' || activeSource.type === 'hentaihaven' || activeSource.type === 'nhentai') {
      return parts.join(' ').trim();
    }
    if (filter.sortBy === 'score') {
      if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        // The Gelbooru engine only sorts by total score; the time range
        // is converted to a lower-bound id (`id:>X`) inside fetchGelbooruPosts.
        parts.push('sort:score:desc');
      } else if (activeSource.type === 'danbooru') {
        // 'age:1w' fetches exactly week-olds; ranges need '<' (verified live)
        if (filter.timeRange === '1d') {
          parts.push('age:<1day', 'order:score');
        } else if (filter.timeRange === '1w') {
          parts.push('age:<1week', 'order:score');
        } else if (filter.timeRange === '1m') {
          parts.push('age:<1month', 'order:score');
        } else if (filter.timeRange === '1y') {
          parts.push('age:<1year', 'order:score');
        } else {
          parts.push('order:score');
        }
      } else if (activeSource.type === 'moebooru') {
        // Keywords like 'date:today' don't work (return empty, verified live);
        // date:START..END ranges do work
        const days = timeRangeToDays(filter.timeRange);
        if (days > 0) {
          parts.push('order:score', `date:${pastYMD(days)}..${formatYMD(new Date())}`);
        } else {
          parts.push('order:score');
        }
      } else if (activeSource.type === 'cumst') {
        if (filter.timeRange === '1d') {
          parts.push('period:day', 'sort:popular');
        } else if (filter.timeRange === '1w') {
          parts.push('period:week', 'sort:popular');
        } else if (filter.timeRange === '1m') {
          parts.push('period:month', 'sort:popular');
        } else {
          parts.push('sort:popular');
        }
      }
    } else if (filter.sortBy === 'id') {
      if (activeSource.type === 'cumst') {
        parts.push('sort:recent');
      } else if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        parts.push('sort:id:desc');
      } else if (activeSource.type === 'moebooru') {
        parts.push('order:id_desc');
      } else {
        parts.push('order:id');
      }
    } else if (filter.sortBy === 'height') {
      if (activeSource.type === 'cumst') {
        parts.push('sort:attachments');
      } else if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        parts.push('sort:height:desc');
      } else {
        parts.push('order:height');
      }
    } else if (filter.sortBy === 'width') {
      if (activeSource.type === 'cumst') {
        parts.push('sort:videos');
      } else if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        parts.push('sort:width:desc');
      } else {
        parts.push('order:width');
      }
    }

    return parts.join(' ').trim();
  }

  private async filterBlacklistedPosts(
    posts: BooruPost[],
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    if (includeBlacklisted || !posts || posts.length === 0) {
      return posts;
    }

    let blacklistedTags: string[] = [];
    try {
      blacklistedTags = await StorageService.getBlacklistedTags();
    } catch {
      blacklistedTags = [];
    }

    if (!blacklistedTags || blacklistedTags.length === 0) {
      return posts;
    }

    const blacklistSet = new Set<string>();
    for (const tag of blacklistedTags) {
      const lower = tag.trim().toLowerCase();
      if (lower) {
        blacklistSet.add(lower);
        blacklistSet.add(lower.replace(/\s+/g, '_'));
        blacklistSet.add(lower.replace(/_/g, ' '));
      }
    }

    const checkTag = (t: string | undefined): boolean => {
      if (!t) return false;
      const lower = t.trim().toLowerCase();
      return (
        blacklistSet.has(lower) ||
        blacklistSet.has(lower.replace(/\s+/g, '_')) ||
        blacklistSet.has(lower.replace(/_/g, ' '))
      );
    };

    return posts.filter((post) => {
      // 1. post.allTags
      if (post.allTags) {
        for (let i = 0; i < post.allTags.length; i++) {
          if (checkTag(post.allTags[i])) return false;
        }
      }

      // 1b. RedGifs niches — 'niche:<id>' matches blacklist entries
      if (post.niches) {
        for (let i = 0; i < post.niches.length; i++) {
          const nid = post.niches[i]?.trim().toLowerCase();
          if (nid && blacklistSet.has(`niche:${nid}`)) return false;
        }
      }

      // 1c. RedGifs users — 'user:<name>' blacklist entries match the artist
      if (post.tags?.artist) {
        for (let i = 0; i < post.tags.artist.length; i++) {
          const aname = post.tags.artist[i]?.trim().toLowerCase();
          if (aname && blacklistSet.has(`user:${aname}`)) return false;
        }
      }

      // 2. tags.artist, character, copyright, general, meta
      const tg = post.tags;
      if (tg) {
        const groups = [tg.artist, tg.character, tg.copyright, tg.general, tg.meta];
        for (let g = 0; g < groups.length; g++) {
          const grp = groups[g];
          if (Array.isArray(grp)) {
            for (let i = 0; i < grp.length; i++) {
              if (checkTag(grp[i])) return false;
            }
          }
        }
      }

      return true;
    });
  }

  async fetchPostsWithFilter(
    filter: SearchFilterConfig,
    page: number = 1,
    limit: number = 20,
    source: BooruSource = this.currentSource
  ): Promise<BooruPost[]> {
    const queryTags = this.buildQueryTags(filter, source);
    return await this.fetchPosts(page, limit, queryTags, filter, source);
  }

  async fetchPosts(
    page: number = 1,
    limit: number = 20,
    tags: string = '',
    filter?: SearchFilterConfig,
    source: BooruSource = this.currentSource
  ): Promise<BooruPost[]> {
    const includeBlacklisted = filter?.includeBlacklisted ?? false;

    try {
      if (source.id === 'gelbooru') {
        // Gelbooru DAPI always returns 401 without an API key; go straight to HTML scrape
        // when no key is saved. When a key IS saved, surface 401 (bad key) but fall back
        // to HTML scrape on 429 rate-limit / 5xx / network timeouts so the feed still opens.
        const { userId, apiKey } = await StorageService.getGelbooruAuth().catch(() => ({ userId: '', apiKey: '' }));
        if (userId.trim() && apiKey.trim()) {
          try {
            return await this.fetchGelbooruPosts(source, page, limit, tags, includeBlacklisted, filter);
          } catch (err: any) {
            const msg = String(err?.message || '');
            if (err?.name === 'AbortError' || /401|unauthorized|authentication required/i.test(msg)) {
              throw err;
            }
            return await this.fetchGelbooruScrapedPosts(source, page, limit, tags, includeBlacklisted);
          }
        }
        return await this.fetchGelbooruScrapedPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'gelbooru') {
        return await this.fetchGelbooruPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'moebooru') {
        return await this.fetchMoebooruPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'realbooru') {
        return await this.fetchRealbooruPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'cumst') {
        return await this.fetchCumStPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'redgifs') {
        // Deduplication belongs to each screen's query session. A shared seen
        // set made browsing one list consume results from another open list.
        return await this.fetchRedGifsPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'xvideos') {
        return await this.fetchXVideosPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'xhamster') {
        return await this.fetchXHamsterPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'pornhub') {
        return await this.fetchPornhubPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'sexcom') {
        return await this.fetchSexComPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'hentaihaven') {
        return await this.fetchHentaiHavenPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'nhentai') {
        return await this.fetchNHentaiPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else {
        return await this.fetchDanbooruPosts(source, page, limit, tags, includeBlacklisted);
      }
    } catch (error) {
      console.warn(`[BooruAPI] Error fetching posts from ${source.name}:`, error);
      throw error;
    }
  }

  private async fetchGelbooruScrapedPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const pid = Math.max(0, (page - 1) * 42);
    const queryParams = new URLSearchParams({
      page: 'post',
      s: 'list',
      pid: String(pid),
      tags: cleanTags || 'all',
    });

    const url = `${source.baseUrl}/index.php?${queryParams.toString()}`;
    const response = await this.fetchWithRetry(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${source.baseUrl}/`,
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Gelbooru web rate limit exceeded (429 Too Many Requests). Please wait a while.');
      }
      if (response.status >= 500) {
        throw new Error(`Gelbooru web server overloaded (${response.status} ${response.statusText}).`);
      }
      throw new Error(`Gelbooru error: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const articleRegex = /<article\s+class=["'][^"']*thumbnail-preview[^"']*["'][^>]*>[\s\S]*?<a\s+[^>]*id=["']p?(\d+)["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<img\s+[^>]*src=["']([^"']+)["']([^>]*)>[\s\S]*?<\/article>/gi;

    const posts: BooruPost[] = [];
    let match;

    while ((match = articleRegex.exec(html)) !== null) {
      const [, id, href, thumbSrc, imgAttrs] = match;
      const titleMatch = imgAttrs.match(/title=["']([^"']*)["']/i);
      const altMatch = imgAttrs.match(/alt=["']([^"']*)["']/i);
      const title = titleMatch ? titleMatch[1] : '';
      const alt = altMatch ? altMatch[1] : '';

      let rating: 's' | 'q' | 'e' | 'g' = 's';
      const ratingMatch = title.match(/rating:(\w+)/i);
      if (ratingMatch) {
        rating = normalizeRating(ratingMatch[1]);
      }

      let score = 0;
      const scoreMatch = title.match(/score:(-?\d+)/i);
      if (scoreMatch) {
        score = parseInt(scoreMatch[1], 10);
      }

      const rawTagStr = title
        .replace(/score:-?\d+/gi, '')
        .replace(/rating:\w+/gi, '')
        .trim();
      const rawTags = Array.from(new Set<string>(rawTagStr.split(/\s+/).filter(Boolean)));

      const isVideo =
        thumbSrc.endsWith('.mp4') ||
        rawTags.some((t) => ['video', 'webm', 'mp4', 'sound', 'animated'].includes(t.toLowerCase()));

      // The list HTML has no dimensions; real sizes live on the post page.
      // width/height stay as placeholders (800x1000) until the Info modal
      // fills in the real values (resolveRealDimensions).
      const width = 800;
      const height = 1000;

      let rawOriginal = thumbSrc;
      let rawSample = thumbSrc;
      let fileExt = 'jpg';

      const imgPattern = /https:\/\/([a-z0-9]+)\.gelbooru\.com\/thumbnails\/([a-f0-9]+)\/([a-f0-9]+)\/thumbnail_([a-f0-9]+)\.([a-z0-9]+)/i;
      const imgMatch = thumbSrc.match(imgPattern);

      if (imgMatch) {
        const [, sub, dir1, dir2, hash, thumbnailExt] = imgMatch;
        // The thumbnail extension is not the same as the original. Gelbooru serves
        // JPEG originals as .jpg for thumbnail/sample but .jpeg for the original;
        // a .jpg guess ends in a 404/hotlink redirect.
        // On the scrape path the sample stays the trusted fallback until the real
        // extension is resolved from the post page; only DAPI gives the original via its real file_url.
        fileExt = thumbnailExt;
        if (isVideo) {
          rawOriginal = `https://${sub}.gelbooru.com/images/${dir1}/${dir2}/${hash}.mp4`;
          rawSample = rawOriginal;
          fileExt = 'mp4';
        } else {
          rawSample = `https://${sub}.gelbooru.com/samples/${dir1}/${dir2}/sample_${hash}.${thumbnailExt}`;
          rawOriginal = '';
        }
      }

      const previewUrl = ensureAbsoluteUrl(thumbSrc, source.baseUrl);
      const sampleUrl = ensureAbsoluteUrl(rawSample, source.baseUrl);
      const originalUrl = rawOriginal ? ensureAbsoluteUrl(rawOriginal, source.baseUrl) : '';

      posts.push({
        id: `gelbooru_${id}`,
        sourceId: source.id,
        sourceName: source.name,
        previewUrl,
        sampleUrl,
        originalUrl,
        width,
        height,
        aspectRatio: width > 0 && height > 0 ? width / height : 0.75,
        rating,
        score,
        favCount: 0,
        tags: {
          artist: [],
          character: [],
          copyright: [],
          general: rawTags,
          meta: isVideo ? ['video'] : [],
        },
        allTags: rawTags,
        sourceLink: `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
        fileExt,
        createdAt: new Date().toISOString(),
      });
    }

    return await this.filterBlacklistedPosts(posts, includeBlacklisted);
  }

  private async fetchGelbooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const windowDays =
      filter?.sortBy === 'score' ? timeRangeToDays(filter.timeRange) : 0;
    if (windowDays > 0) {
      // Find the period's lower-bound id, then let the server sort the popular posts.
      // The walk runs id-desc; the `change` field is used for dates
      // (it's the last-edit time, not the upload — posts near the bound deviate by +-).
      const walkTags = cleanTags.replace('sort:score:desc', 'sort:id:desc');
      const bound = await this.resolveGelbooruLowerBound(source, walkTags, windowDays);
      if (bound === null) return [];
      const pid = Math.max(0, page - 1);
      return await this.fetchGelbooruPage(
        source,
        pid,
        limit,
        `${cleanTags} id:>${bound - 1}`,
        includeBlacklisted
      );
    }
    const pid = Math.max(0, page - 1);
    return await this.fetchGelbooruPage(source, pid, limit, cleanTags, includeBlacklisted);
  }

  /** Walks backwards through recent additions, returns the smallest id inside the date threshold */
  private async resolveGelbooruLowerBound(
    source: BooruSource,
    walkTags: string,
    windowDays: number
  ): Promise<number | null> {
    const key = `${source.id}|${walkTags}|${windowDays}`;
    const cached = gelbooruBoundCache.get(key);
    if (cached !== undefined) return cached;

    const cutoff = Date.now() - windowDays * 86400000;
    let bound: number | null = null;
    for (let pid = 0; pid < BOUND_MAX_PAGES; pid++) {
      const batch = await this.fetchGelbooruPage(
        source,
        pid,
        BOUND_WALK_LIMIT,
        walkTags,
        false
      );
      if (batch.length === 0) break;
      for (const p of batch) {
        const nid = Number(p.id);
        if (!Number.isFinite(nid)) continue;
        const t = new Date(p.createdAt).getTime();
        if (Number.isFinite(t) && t >= cutoff) {
          if (bound === null || nid < bound) bound = nid;
        }
      }
      if (batch.length < BOUND_WALK_LIMIT) break;
      // If the page's oldest (last) post is older than the threshold, don't walk further back
      const lastT = new Date(batch[batch.length - 1].createdAt).getTime();
      if (Number.isFinite(lastT) && lastT < cutoff) break;
    }
    gelbooruBoundCache.set(key, bound);
    return bound;
  }

  private async fetchGelbooruPage(
    source: BooruSource,
    pid: number,
    limit: number,
    cleanTags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    const isRule34 = source.id === 'rule34';
    const apiName = isRule34 ? 'Rule34' : 'Gelbooru';
    const queryParams = new URLSearchParams({
      page: 'dapi',
      s: 'post',
      q: 'index',
      json: '1',
      limit: String(limit),
      pid: String(Math.max(0, pid)),
    });
    if (cleanTags) {
      queryParams.append('tags', cleanTags);
    }
    if (source.authParams) {
      const authTokens = new URLSearchParams(source.authParams);
      authTokens.forEach((v, k) => queryParams.append(k, v));
    }
    // The user's own Gelbooru key (doc order: &api_key=...&user_id=...)
    if (source.id === 'gelbooru') {
      try {
        const { userId, apiKey } = await StorageService.getGelbooruAuth();
        if (apiKey.trim() && userId.trim()) {
          queryParams.append('api_key', apiKey.trim());
          queryParams.append('user_id', userId.trim());
        }
      } catch {}
    }

    if (isRule34) {
      const { userId, apiKey } = await StorageService.getRule34Auth();
      if (userId.trim() && apiKey.trim()) {
        queryParams.set('api_key', apiKey.trim());
        queryParams.set('user_id', userId.trim());
      }
      if (!queryParams.get('api_key') || !queryParams.get('user_id')) {
        throw new Error(RULE34_AUTH_ERROR);
      }
    }

    const url = `${source.apiBaseUrl || source.baseUrl}/index.php?${queryParams.toString()}`;
    const response = await this.fetchWithRetry(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (isRule34 && (response.status === 401 || response.status === 403)) {
        throw new Error(RULE34_AUTH_ERROR);
      }
      if (response.status === 401) {
        throw new Error('Gelbooru API authentication required (401 Unauthorized). Please set your API key (api_key and user_id) on the Settings screen.');
      }
      if (response.status === 429) {
        throw new Error(`${apiName} rate limit exceeded (429 Too Many Requests). Please wait a few seconds or check your API key.`);
      }
      if (response.status >= 500) {
        throw new Error(`${apiName} server overloaded or search query timed out (${response.status} ${response.statusText}).`);
      }
      throw new Error(`${apiName} API error: ${response.status} ${response.statusText}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(`${apiName} API did not return a valid JSON response (server overloaded or search could not complete).`);
    }
    // Rule34 returns HTTP 200 with a JSON string for missing/invalid auth.
    // Do not turn API failures into an apparently successful empty feed.
    if (isRule34 && (typeof data === 'string' || data?.success === false)) {
      const message = typeof data === 'string' ? data : String(data?.message || '');
      if (/auth|api.?key|user.?id|access.denied/i.test(message)) {
        throw new Error(RULE34_AUTH_ERROR);
      }
      throw new Error('Rule34 API could not complete the request. Please try again later.');
    }
    let rawItems: any[] = [];
    if (Array.isArray(data)) {
      rawItems = data;
    } else if (Array.isArray(data?.post)) {
      rawItems = data.post;
    } else if (data?.post && typeof data.post === 'object') {
      rawItems = [data.post];
    } else if (Array.isArray(data?.posts)) {
      rawItems = data.posts;
    } else {
      return [];
    }

    const posts = rawItems
      .filter((item: any) => item && (item.preview_url || item.sample_url || item.file_url || item.image))
      .map((item: any): BooruPost => {
        let original = item.file_url || (item.directory !== undefined && item.image ? `${source.baseUrl}/images/${item.directory}/${item.image}` : '');
        let preview = item.preview_url || (item.directory !== undefined && item.image ? `${source.baseUrl}/thumbnails/${item.directory}/thumbnail_${item.image}` : '');
        let sample = item.sample_url || original || preview;
        if (!original) original = sample;
        if (!preview) preview = sample;

        preview = ensureAbsoluteUrl(preview, source.baseUrl);
        sample = ensureAbsoluteUrl(sample, source.baseUrl);
        original = ensureAbsoluteUrl(original, source.baseUrl);

        const width = Number(item.width) || 800;
        const height = Number(item.height) || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;
        const rawTags = Array.from(new Set<string>(asTagList(item.tags)));

        return {
          id: String(item.id),
          sourceId: source.id,
          sourceName: source.name,
          previewUrl: preview,
          sampleUrl: sample,
          originalUrl: original,
          width,
          height,
          aspectRatio,
          rating: normalizeRating(item.rating),
          score: Number(item.score) || 0,
          favCount: Number(item.change) || 0,
          tags: {
            artist: [],
            character: [],
            copyright: [],
            general: rawTags,
            meta: [],
          },
          allTags: rawTags,
          sourceLink: item.source || undefined,
          fileExt: typeof item.image === 'string' ? item.image.split('.').pop() : undefined,
          createdAt: item.change ? new Date(item.change * 1000).toISOString() : new Date().toISOString(),
        };
      });

    return await this.filterBlacklistedPosts(posts, includeBlacklisted);
  }

  private async fetchDanbooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const queryParams = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (cleanTags) {
      queryParams.append('tags', cleanTags);
    }

    const url = `${source.baseUrl}/posts.json?${queryParams.toString()}`;
    const response = await fetchBooru(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Danbooru API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const posts = data
      .filter((item: any) => item && (item.file_url || item.large_file_url || item.preview_file_url))
      .map((item: any): BooruPost => {
        const preview = ensureAbsoluteUrl(item.preview_file_url || item.large_file_url || item.file_url, source.baseUrl);
        const sample = ensureAbsoluteUrl(item.large_file_url || item.file_url || item.preview_file_url, source.baseUrl);
        const original = ensureAbsoluteUrl(item.file_url || item.large_file_url || item.preview_file_url, source.baseUrl);

        const width = item.image_width || 800;
        const height = item.image_height || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;

        const artist = Array.from(new Set<string>(asTagList(item.tag_string_artist)));
        const character = Array.from(new Set<string>(asTagList(item.tag_string_character)));
        const copyright = Array.from(new Set<string>(asTagList(item.tag_string_copyright)));
        const general = Array.from(new Set<string>(asTagList(item.tag_string_general)));
        const meta = Array.from(new Set<string>(asTagList(item.tag_string_meta)));

        const allTags = Array.from(new Set<string>(asTagList(item.tag_string).length > 0 ? asTagList(item.tag_string) : [...artist, ...character, ...copyright, ...general]));

        return {
          id: String(item.id),
          sourceId: source.id,
          sourceName: source.name,
          previewUrl: preview,
          sampleUrl: sample,
          originalUrl: original,
          width,
          height,
          aspectRatio,
          rating: normalizeRating(item.rating),
          score: item.score || 0,
          favCount: item.fav_count || 0,
          tags: { artist, character, copyright, general, meta },
          allTags,
          sourceLink: item.source || undefined,
          fileExt: item.file_ext,
          fileSize: item.file_size,
          createdAt: item.created_at || new Date().toISOString(),
        };
      });

    return await this.filterBlacklistedPosts(posts, includeBlacklisted);
  }

  private async fetchMoebooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const queryParams = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (cleanTags) {
      queryParams.append('tags', cleanTags);
    }

    const url = `${source.baseUrl}/post.json?${queryParams.toString()}`;
    const response = await fetchBooru(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Moebooru API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const posts = data
      .filter((item: any) => item && (item.preview_url || item.sample_url || item.file_url))
      .map((item: any): BooruPost => {
        const preview = ensureAbsoluteUrl(item.preview_url || item.sample_url || item.file_url, source.baseUrl);
        const sample = ensureAbsoluteUrl(item.sample_url || item.file_url || item.preview_url, source.baseUrl);
        const original = ensureAbsoluteUrl(item.file_url || item.sample_url || item.preview_url, source.baseUrl);

        const width = item.width || 800;
        const height = item.height || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;

        const rawTags = Array.from(new Set<string>(asTagList(item.tags)));

        return {
          id: String(item.id),
          sourceId: source.id,
          sourceName: source.name,
          previewUrl: preview,
          sampleUrl: sample,
          originalUrl: original,
          width,
          height,
          aspectRatio,
          rating: normalizeRating(item.rating),
          score: item.score || 0,
          favCount: 0,
          tags: {
            artist: [],
            character: [],
            copyright: [],
            general: rawTags,
            meta: [],
          },
          allTags: rawTags,
          sourceLink: item.source || undefined,
          fileExt: item.file_ext,
          fileSize: item.file_size,
          createdAt: item.created_at ? new Date(item.created_at * 1000).toISOString() : new Date().toISOString(),
        };
      });

    return await this.filterBlacklistedPosts(posts, includeBlacklisted);
  }

  private async fetchRealbooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    // Realbooru lists 42 posts per page (pid=0, 42, 84, ...)
    const pid = (page - 1) * 42;
    const queryParams = new URLSearchParams({
      page: 'post',
      s: 'list',
      pid: String(pid),
    });
    if (cleanTags) {
      queryParams.append('tags', cleanTags);
    }

    const url = `${source.baseUrl}/index.php?${queryParams.toString()}`;
    const response = await fetchBooru(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${source.baseUrl}/`,
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`Realbooru error: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const postRegex = /<div\s+class=["'][^"']*thumb[^"']*["']\s+id=["']s?(\d+)["']>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']>[\s\S]*?<img\s+[^>]*src=["']([^"']+)["']([^>]*)>/gi;
    const posts: BooruPost[] = [];

    let match;
    while ((match = postRegex.exec(html)) !== null) {
      const id = match[1];
      const postHref = match[2];
      const thumbSrc = match[3];
      const imgAttrs = match[4];

      const altMatch = imgAttrs.match(/alt=["']([^"']*)["']/i);
      const titleMatch = imgAttrs.match(/title=["']([^"']*)["']/i);

      const alt = altMatch ? altMatch[1] : '';
      const title = titleMatch ? titleMatch[1] : '';

      let rating: 's' | 'q' | 'e' | 'g' = 's';
      if (title.includes('rating:questionable') || title.includes('rating:q')) rating = 'q';
      else if (title.includes('rating:explicit') || title.includes('rating:e')) rating = 'e';

      let score = 0;
      const scoreMatch = title.match(/score:(\d+)/);
      if (scoreMatch) score = parseInt(scoreMatch[1], 10);

      let rawThumb = thumbSrc;
      if (rawThumb.startsWith('//')) rawThumb = 'https:' + rawThumb;
      else if (rawThumb.startsWith('/')) rawThumb = `${source.baseUrl}${rawThumb}`;
      else if (!rawThumb.startsWith('http')) rawThumb = `${source.baseUrl}/${rawThumb}`;

      const thumbPattern = /thumbnails\/([a-f0-9]+)\/([a-f0-9]+)\/thumbnail_([a-f0-9]+)\./i;
      const thumbMatch = rawThumb.match(thumbPattern);

      const rawTags = Array.from(
        new Set<string>(
          title
            ? title.replace(/score:\d+/g, '').replace(/rating:\w+/g, '').split(/[\s,]+/).filter(Boolean)
            : alt.split(/[\s,]+/).filter(Boolean)
        )
      );

      const lowerTags = rawTags.map((t) => t.toLowerCase());
      const hasGifTag = lowerTags.includes('gif');
      const hasVideoTag = lowerTags.some((t) => t === 'video' || t === 'webm' || t === 'mp4');
      // GIFs are tagged `animated` + `gif` (no `video` tag) and must not be
      // treated as videos: the viewer would hand a .gif to the video player.
      const isGif = hasGifTag && !hasVideoTag;
      const isVideo =
        !isGif &&
        (rawThumb.endsWith('.mp4') ||
          rawThumb.endsWith('.webm') ||
          lowerTags.some((t) => ['video', 'webm', 'mp4', 'sound', 'animated'].includes(t)));

      // Extract verified file URL / extension from HTML if available (a href, data attributes, etc.)
      let verifiedExt: string | null = null;
      let verifiedOriginalUrl: string | null = null;

      const cleanHref = postHref ? postHref.replace(/&amp;/g, '&').trim() : '';
      const hrefExtMatch = cleanHref.split('?')[0].match(/\.(mp4|webm|mov|m4v|png|jpe?g|gif)$/i);
      if (hrefExtMatch) {
        verifiedExt = hrefExtMatch[1].toLowerCase().replace('jpeg', 'jpg');
        verifiedOriginalUrl = ensureAbsoluteUrl(cleanHref, source.baseUrl);
      }

      if (!verifiedExt) {
        const dataUrlMatch = match[0].match(/data-(?:file|src|original|original-url|media)=["']([^"']+)["']/i);
        if (dataUrlMatch) {
          const dataUrl = dataUrlMatch[1].replace(/&amp;/g, '&').trim();
          const extMatch = dataUrl.split('?')[0].match(/\.(mp4|webm|mov|m4v|png|jpe?g|gif)$/i);
          if (extMatch) {
            verifiedExt = extMatch[1].toLowerCase().replace('jpeg', 'jpg');
            verifiedOriginalUrl = ensureAbsoluteUrl(dataUrl, source.baseUrl);
          }
        }
      }

      if (!verifiedExt) {
        const dataExtMatch = match[0].match(/data-ext=["']([a-z0-9]+)["']/i);
        if (dataExtMatch) {
          verifiedExt = dataExtMatch[1].toLowerCase().replace('jpeg', 'jpg');
        }
      }

      let fileExt = verifiedExt || (isGif ? 'gif' : isVideo ? 'mp4' : 'jpg');

      let rawOriginal = '';
      let rawSample = rawThumb;

      if (verifiedOriginalUrl) {
        rawOriginal = verifiedOriginalUrl;
        rawSample = verifiedOriginalUrl;
      } else if ((isVideo || isGif) && thumbMatch) {
        const [, dir1, dir2, hash] = thumbMatch;
        // Thumbnail and file share the hash. GIFs keep the light thumbnail as
        // the sample (full GIFs are tens of MB — never a grid frame) and only
        // the original points at the .gif; the viewer loads it at open.
        rawOriginal = `${source.baseUrl}/images/${dir1}/${dir2}/${hash}.${isGif ? 'gif' : 'mp4'}`;
        rawSample = isGif ? rawThumb : rawOriginal;
      } else {
        // The original extension can't be derived from the thumbnail extension (a jpeg guess produces 404s).
        // Without a verified url at scrape time the sample stays on the preview,
        // while the original is resolved from the post page in the viewer via resolveGelbooruOriginalUrl.
        rawSample = rawThumb;
        rawOriginal = '';
      }

      const previewUrl = ensureAbsoluteUrl(rawThumb, source.baseUrl);
      const sampleUrl = ensureAbsoluteUrl(rawSample, source.baseUrl);
      const originalUrl = rawOriginal ? ensureAbsoluteUrl(rawOriginal, source.baseUrl) : '';

      const sourceLink = cleanHref.includes('page=post')
        ? ensureAbsoluteUrl(cleanHref, source.baseUrl)
        : `${source.baseUrl}/index.php?page=post&s=view&id=${id}`;

      posts.push({
        id: `realbooru_${id}`,
        sourceId: source.id,
        sourceName: source.name,
        previewUrl,
        sampleUrl,
        originalUrl,
        width: 800,
        height: 1000,
        aspectRatio: 0.8,
        rating,
        score,
        favCount: 0,
        tags: {
          artist: [],
          character: [],
          copyright: [],
          general: rawTags,
          meta: isVideo ? ['video'] : [],
        },
        allTags: rawTags,
        sourceLink,
        fileExt,
        createdAt: new Date().toISOString(),
      });
    }

    return await this.filterBlacklistedPosts(posts, includeBlacklisted);
  }

  private redGifsToken: string | null = null;
  private redGifsTokenExpiry: number = 0;
  private redGifsTokenScope = '';
  private redGifsTokenRequest: { scope: string; id: symbol; promise: Promise<string> } | null = null;

  private async fetchRedGifsApi(url: string, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Origin: 'https://www.redgifs.com',
      Referer: 'https://www.redgifs.com/',
      Accept: 'application/json',
      'Cache-Control': 'no-store, no-cache',
    };
    if (token) {
      // RedGifs expects a single header; sending all three variants at once
      // looked like a workaround trying to break the WAF.
      headers['Authorization'] = `Bearer ${token}`;
    }
    return await this.fetchWithRetry(url, { headers }, 0, 10000);
  }

  private async getRedGifsToken(rejectedToken?: string): Promise<string> {
    await proxyService.ensureInitialized();
    const scope = proxyService.isEnabled() ? proxyService.getWorkerUrl() : 'direct';
    // A late-arriving 401 from another request must not wipe a newer, valid token.
    if (rejectedToken && this.redGifsToken === rejectedToken && this.redGifsTokenScope === scope) {
      this.redGifsToken = null;
      this.redGifsTokenExpiry = 0;
    }
    const now = Date.now();
    if (this.redGifsToken && this.redGifsTokenScope === scope && now < this.redGifsTokenExpiry) {
      return this.redGifsToken;
    }
    if (this.redGifsTokenRequest?.scope === scope) {
      return this.redGifsTokenRequest.promise;
    }

    // The token is tied to the connection that requested it. Don't persist it to disk
    // for reuse across launches/IPs: re-reading the same record after a 401 caused a WrongSender loop.
    const id = Symbol(scope);
    const promise = (async () => {
      const authRes = await this.fetchRedGifsApi('https://api.redgifs.com/v2/auth/temporary');
      if (!authRes.ok) {
        const errText = await authRes.text().catch(() => '');
        throw new Error(`RedGifs auth failed (${authRes.status}): ${errText}`);
      }
      const data = await authRes.json();
      if (typeof data?.token !== 'string' || !data.token) {
        throw new Error('Could not obtain RedGifs token (empty response)');
      }
      if (this.redGifsTokenRequest?.id === id) {
        this.redGifsToken = data.token;
        this.redGifsTokenExpiry = Date.now() + 30 * 60 * 1000;
        this.redGifsTokenScope = scope;
      }
      return data.token as string;
    })();
    this.redGifsTokenRequest = { scope, id, promise };
    try {
      return await promise;
    } finally {
      if (this.redGifsTokenRequest?.promise === promise) this.redGifsTokenRequest = null;
    }
  }

  private async fetchAuthenticatedRedGifs(url: string): Promise<Response> {
    const token = await this.getRedGifsToken();
    const response = await this.fetchRedGifsApi(url, token);
    if (response.status !== 401) return response;
    const refreshed = await this.getRedGifsToken(token);
    // Single refresh allowance: a persistent network/proxy problem won't cause an infinite auth loop.
    return this.fetchRedGifsApi(url, refreshed);
  }

  /**
   * Warms up the RedGifs token in the background. Called at app launch:
   * the Discover screen doesn't wait for the auth round-trip.
   */
  async warmupRedGifs(): Promise<void> {
    try {
      await this.getRedGifsToken();
    } catch (e) {
      console.warn('[BooruAPI] RedGifs warmup failed:', e);
    }
  }

  private async fetchRedGifsPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    let cleanTags = tags.trim();
    // If tags carry no rating filter etc. and this is a direct tag search,
    // also check filter.tags
    if (!cleanTags && filter?.tags && filter.tags.length > 0) {
      cleanTags = filter.tags.map((t) => t.trim()).filter(Boolean).join(' ');
    }

    // RedGifs doesn't know the '-tag' exclusion syntax; includes/excludes are split
    // and excluded ones are filtered client-side without being sent to the server
    const normTag = (t: string) => t.toLowerCase().replace(/\s+/g, '_');
    const tokens = cleanTags.split(/\s+/).filter(Boolean);
    const excludeTags = tokens.filter((t) => t.startsWith('-')).map((t) => normTag(t.replace(/^-+/, ''))).filter(Boolean);
    // '-niche:<id>' exclusions match post.niches
    const nicheExcludes = excludeTags
      .filter((t) => t.startsWith('niche:'))
      .map((t) => t.substring(6).trim())
      .filter(Boolean);
    // '-user:<name>' exclusions match post.tags.artist
    const userExcludes = excludeTags
      .filter((t) => t.startsWith('user:'))
      .map((t) => t.substring(5).trim().toLowerCase())
      .filter(Boolean);
    const includeTokens = tokens
      .filter((t) => !t.startsWith('-'))
      .filter((t) => !t.toLowerCase().startsWith('user:'));
    // The 'user:<name>' spelling works through the same mechanism as the User field in the filter
    const userToken = tokens.find((t) => !t.startsWith('-') && t.toLowerCase().startsWith('user:'));
    const tokenUsername = userToken ? userToken.substring(5).trim() : '';
    // Decode display labels such as real_couples back to RedGifs search text.
    // Keep the original tokens for local filters and user/niche identifiers.
    const includeTags = redGifsSearchText(includeTokens.join(' '));

    // Order mapping (RedGifs Order values: trending, latest, score, top7, top28, top)
    let order = 'trending';
    if (filter?.sortBy === 'id') {
      order = 'latest';
    } else if (filter?.sortBy === 'score') {
      if (filter.timeRange === '1d') {
        order = 'trending';
      } else if (filter.timeRange === '1w') {
        order = 'top7';
      } else if (filter.timeRange === '1m') {
        order = 'top28';
      } else if (filter.timeRange === '1y' || filter.timeRange === 'all') {
        order = 'top';
      } else {
        order = 'score';
      }
    } else if (filter?.sortBy === 'rating' || filter?.sortBy === 'user') {
      order = 'trending';
    }

    const count = Math.min(Math.max(limit, 10), 40);
    // Niche (category) search: when a 'niche:<id>' token is seen, the library's
    // category equivalent /v2/niches/{id}/gifs is used (verified live).
    // That endpoint takes no tags; remaining tags are filtered client-side.
    const nicheToken = includeTokens.find((t) => t.toLowerCase().startsWith('niche:'));
    const nicheId = nicheToken ? nicheToken.substring(6).trim() : '';
    const remainingTokens = nicheId ? includeTokens.filter((t) => t !== nicheToken) : includeTokens;
    const remainingTags = remainingTokens.map((t) => t.trim()).filter(Boolean).join(' ');
    // User/creator search: the User field in the filter or the 'user:<name>' spelling
    // (the library's search_user equivalent, verified live).
    // Note: this endpoint returns empty with order=trending (latest is required) and doesn't
    // support tags (adding tags returns 0); with user+tags combined, tags are filtered client-side.
    const searchUsername = filter?.user?.trim() || tokenUsername;
    const searchUrl = searchUsername
      ? `https://api.redgifs.com/v2/users/${encodeURIComponent(searchUsername)}/search?page=${page}&count=${count}&order=latest&type=g`
      : nicheId
      ? `https://api.redgifs.com/v2/niches/${encodeURIComponent(nicheId)}/gifs?count=${count}&page=${page}`
      : includeTags
      ? `https://api.redgifs.com/v2/gifs/search?type=g&order=${order}&count=${count}&page=${page}&tags=${encodeURIComponent(includeTags)}`
      : `https://api.redgifs.com/v2/gifs/search?type=g&order=${order}&count=${count}&page=${page}`;

    const response = await this.fetchAuthenticatedRedGifs(searchUrl);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 404 && searchUsername) {
        throw new Error(`RedGifs user not found: ${searchUsername}`);
      }
      if (response.status === 404 && nicheId) {
        throw new Error(`RedGifs category not found: ${nicheId}`);
      }
      throw new Error(`RedGifs API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const gifs = Array.isArray(data.gifs) ? data.gifs : [];

    const posts = this.mapRedGifsGifs(source, gifs);

    // Client-side filtering: the server doesn't filter user/niche+tag combos or '-tag'
    // exclusions; they're removed here
    const filterTokens = nicheId ? remainingTokens : includeTokens;
    const needsClientFilter =
      excludeTags.length > 0 || ((searchUsername || nicheId) && filterTokens.length > 0);
    let filtered = posts;
    if (needsClientFilter) {
      const includeNorm = filterTokens.map(normTag).filter(Boolean);
      filtered = posts.filter((p) => {
        const hay = p.allTags.map(normTag);
        if (excludeTags.some((t) => hay.includes(t))) return false;
        if ((searchUsername || nicheId) && includeNorm.some((t) => !hay.includes(t))) return false;
        // '-niche:<id>' exclusion: drop posts in this category
        if (nicheExcludes.length > 0 && p.niches?.some((n) => nicheExcludes.includes(normTag(n)))) return false;
        // '-user:<name>' exclusion: drop posts from this account
        if (userExcludes.length > 0 && p.tags.artist?.some((a) => userExcludes.includes(a.trim().toLowerCase()))) return false;
        return true;
      });
    }
    return await this.filterBlacklistedPosts(filtered, includeBlacklisted);
  }

  /** Converts raw gif records from the RedGifs API into BooruPosts. */
  private mapRedGifsGifs(source: BooruSource, gifs: any[]): BooruPost[] {
    return gifs.map((g: any) => {
      const hdUrl = g.urls?.hd || '';
      const sdUrl = g.urls?.sd || '';
      const silentUrl = g.urls?.silent || '';
      const fullVideo = hdUrl || sdUrl || silentUrl;
      const coverUrls: string[] = [g.urls?.thumbnail, g.urls?.poster]
        .filter((url): url is string => typeof url === 'string' && !!url.trim())
        .map((url) => url.trim());
      const previewThumb = coverUrls[0] || '';
      const previewFallback = coverUrls.find((url) => url !== previewThumb);
      const sampleMedia = sdUrl || silentUrl || fullVideo;

      const rawTags = Array.isArray(g.tags) ? g.tags : [];
      const generalTags = rawTags
        .filter((t: any) => typeof t === 'string')
        .map((t: string) => t.toLowerCase().replace(/\s+/g, '_'));
      const artistTags = typeof g.userName === 'string' && g.userName ? [g.userName] : [];
      const metaTags = ['video', ...(g.hasAudio ? ['sound'] : [])];
      const allTags = Array.from(new Set([...artistTags, ...generalTags, ...metaTags]));
      const nicheIds: string[] = Array.isArray(g.niches)
        ? Array.from(new Set(g.niches.map((n: any) => String(n).trim().toLowerCase()).filter(Boolean)))
        : [];

      const width = Number(g.width) || 720;
      const height = Number(g.height) || 1280;
      const aspectRatio = width > 0 && height > 0 ? width / height : 9 / 16;

      return {
        id: `rg_${g.id}`,
        sourceId: source.id,
        sourceName: source.name,
        previewUrl: previewThumb,
        previewFallbackUrl: previewFallback,
        previewVideoUrl: silentUrl || sdUrl || undefined,
        sampleUrl: sampleMedia,
        originalUrl: fullVideo,
        width,
        height,
        aspectRatio,
        rating: 'e',
        score: Number(g.likes) || 0,
        favCount: Number(g.likes) || 0,
        tags: {
          artist: artistTags,
          character: [],
          copyright: [],
          general: generalTags,
          meta: metaTags,
        },
        allTags,
        sourceLink: `https://www.redgifs.com/watch/${g.id}`,
        fileExt: 'mp4',
        createdAt: g.createDate ? new Date(g.createDate * 1000).toISOString() : new Date().toISOString(),
        niches: nicheIds.length > 0 ? nicheIds : undefined,
      };
    });
  }

  private redGifsTrendingTagsCache: { at: number; tags: RedGifsTrendingTag[] } | null = null;

  /**
   * RedGifs trending search terms: `/v2/tags/trending` → `{tags:[{name,count}]}`
   * (verified live). The surface that diversifies the fixed trending feed; tags
   * change daily. 30-minute memory cache — one request per launch.
   */
  async fetchRedGifsTrendingTags(limit: number = 20): Promise<RedGifsTrendingTag[]> {
    const now = Date.now();
    if (this.redGifsTrendingTagsCache && now - this.redGifsTrendingTagsCache.at < 30 * 60 * 1000) {
      return this.redGifsTrendingTagsCache.tags;
    }

    const url = 'https://api.redgifs.com/v2/tags/trending';
    try {
      const response = await this.fetchAuthenticatedRedGifs(url);
      if (!response.ok) {
        // Row stays empty, the feed keeps working
        console.warn(`[BooruAPI] RedGifs trending tags HTTP ${response.status}`);
        return [];
      }
      const data: any = await response.json();
      const raw: any[] = Array.isArray(data?.tags) ? data.tags : [];
      const tags = raw
        .filter((t: any) => t && typeof t.name === 'string' && t.name.trim().length > 0)
        .map((t: any) => ({ name: String(t.name).trim(), count: Number(t.count) || 0 }))
        .slice(0, limit);
      this.redGifsTrendingTagsCache = { at: now, tags };
      return tags;
    } catch (e) {
      console.warn('[BooruAPI] RedGifs trending tags error:', e);
      return [];
    }
  }

  /**
   * RedGifs niches (categories): trends when the query is empty, search when set.
   * No direct library equivalent; the /v2/niches endpoints are verified live.
   */
  async fetchRedGifsNiches(query?: string): Promise<RedGifsNiche[]> {
    const q = query?.trim();
    const url = q
      ? `https://api.redgifs.com/v2/niches?query=${encodeURIComponent(q)}`
      : 'https://api.redgifs.com/v2/niches/trending?page=1&count=20';
    const response = await this.fetchAuthenticatedRedGifs(url);
    if (!response.ok) {
      // Contract returns [] (looks like no niches); log for diagnostics
      console.warn(`[BooruAPI] RedGifs niches HTTP ${response.status}, returning empty list`);
      return [];
    }
    try {
      const data = await response.json();
      const niches = Array.isArray(data.niches) ? data.niches : [];
      return niches
        .filter((n: any) => n && (typeof n.id === 'string' || typeof n.id === 'number'))
        .map((n: any) => ({
          id: String(n.id),
          name: typeof n.name === 'string' && n.name ? n.name : String(n.id),
          gifCount: Number(n.gifs) || 0,
          subscribers: Number(n.subscribers) || 0,
          thumbnail: typeof n.thumbnail === 'string' ? n.thumbnail : undefined,
        }));
    } catch {
      return [];
    }
  }

  private xvideosBestMonth = '';
  private xvideosBestMonthAt = 0;

  /**
   * Resolves the XVideos `/best` current month (`YYYY-MM`) (6-hour cache).
   * The page-1 `/best` redirect finds the month itself; deeper Discover pages
   * need a month-derived URL. Returns '' when not found, and Discover
   * falls back to the `/new` variants.
   */
  private async resolveXVideosBestMonth(baseUrl: string): Promise<string> {
    const now = Date.now();
    if (this.xvideosBestMonth && now - this.xvideosBestMonthAt < 6 * 60 * 60 * 1000) {
      return this.xvideosBestMonth;
    }
    try {
      const base = (baseUrl || XVIDEOS_BASE).replace(/\/$/, '');
      const res = await this.fetchWithRetry(`${base}/best`, {
        headers: {
          'User-Agent': XVIDEOS_UA,
          Referer: `${XVIDEOS_BASE}/`,
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
      }, 0, 8000);
      if (res.ok) {
        const html = await res.text();
        const m = extractXVideosBestMonth(html);
        if (m) {
          this.xvideosBestMonth = m;
          this.xvideosBestMonthAt = now;
          return m;
        }
      }
    } catch {
      // ignore: the /new fallback is active
    }
    return '';
  }

  private async fetchXVideosPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    // XVideos doesn't understand the '-' exclusion syntax; excluded ones are dropped
    // (list cards carry no tag data, so they can't be filtered client-side).
    const tokens = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !t.startsWith('-'));
    const k = tokens.join(' ');
    void limit;

    // Order mapping (site sort params: relevance, uploaddate,
    // rating, length, views, random). There is no site equivalent for the 'user' sort.
    let sort: XVideosSort = 'relevance';
    let datef: XVideosDatef = 'all';
    const sb = filter?.sortBy;
    if (sb === 'id') {
      sort = 'uploaddate';
    } else if (sb === 'score') {
      sort = 'views';
      datef = xvideosDatefForTimeRange(filter?.timeRange);
    } else if (sb === 'rating') {
      sort = 'rating';
      datef = xvideosDatefForTimeRange(filter?.timeRange);
    } else if (sb === 'height' || sb === 'width') {
      sort = 'length';
    }

    const bestMonth = !k && page > 1 && sort !== 'uploaddate' ? await this.resolveXVideosBestMonth(source.baseUrl || XVIDEOS_BASE) : this.xvideosBestMonth;
    const candidates = buildXVideosSearchCandidates(source.baseUrl || XVIDEOS_BASE, page, k, sort, datef, bestMonth);
    const headers = {
      'User-Agent': XVIDEOS_UA,
      Referer: `${XVIDEOS_BASE}/`,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    };

    let lastError: Error | null = null;
    let reachedSite = false;
    for (const url of candidates) {
      let response: Response;
      try {
        response = await this.fetchWithRetry(url, { headers }, 1, 10000);
      } catch (e: any) {
        lastError = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      // 404 = wrong page variant, try the next candidate; others are real errors
      if (response.status === 404) {
        lastError = new Error(`XVideos page not found (404): ${url}`);
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('XVideos rate limit exceeded (429 Too Many Requests). Please wait a while.');
        }
        if (response.status >= 500) {
          throw new Error(`XVideos server overloaded (${response.status} ${response.statusText}).`);
        }
        throw new Error(`XVideos error: ${response.status} ${response.statusText}`);
      }

      reachedSite = true;
      const html = await response.text();
      const posts = parseXVideosListing(html, source);
      if (posts.length > 0) {
        if (!k) {
          const m = extractXVideosBestMonth(html);
          if (m) {
            this.xvideosBestMonth = m;
            this.xvideosBestMonthAt = Date.now();
          }
        }
        return await this.filterBlacklistedPosts(posts, includeBlacklisted);
      }
      // Empty list: the candidate variant may be wrong, try the next one
    }

    // If the site was never reached (network error / all candidates 404), throw
    // the last error; otherwise there are genuinely no results (end of list) → []
    if (!reachedSite && lastError) throw lastError;
    return [];
  }

  private async fetchSexComPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    // The site has no sort parameter; keywords are searched as plain text.
    const k = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .join(' ');
    void limit;

    const url = buildSexComSearchCandidates(source.baseUrl || SEXCOM_BASE, page, k)[0];
    const headers = {
      'User-Agent': SEXCOM_UA,
      Referer: `${(source.baseUrl || SEXCOM_BASE).replace(/\/$/, '')}/`,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    };

    let response: Response;
    try {
      response = await this.fetchWithRetry(url, { headers }, 1, 10000);
    } catch (e: any) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Sex.com rate limit exceeded (429 Too Many Requests). Please wait a while.');
      }
      if (response.status >= 500) {
        throw new Error(`Sex.com server overloaded (${response.status} ${response.statusText}).`);
      }
      throw new Error(`Sex.com error: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const posts = parseSexComListing(html, source);
    // Premium-locked videos have no full file served: they stay out of the grid.
    return await this.filterBlacklistedPosts(excludePremiumPosts(posts), includeBlacklisted);
  }

  private async fetchHentaiHavenPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    void limit;
    const posts = await fetchHHPostsService(source, page, tags, {
      section: filter?.hentaiHavenSection ?? null,
      sortBy: filter?.sortBy,
    });
    return await this.filterBlacklistedPosts(posts, includeBlacklisted);
  }

  private async fetchNHentaiPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    // YALNIZCA resmi v2 API (https://nhentai.net/api/v2/docs).
    // API; keywords, "exact phrase", -negation, tag:/artist:/language: filtrelerini,
    // Supports the `favorites:>=N` threshold and the date/popular/popular-today/
    // popular-week/popular-month sorts locally.
    const fullQuery = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .join(' ');
    void limit;

    const apiSort = nhentaiApiSort(filter?.sortBy, filter?.timeRange);
    const candidates = buildNHentaiApiCandidates(page, fullQuery, apiSort, filter?.minScore);

    // Safari mimicry (verified on device): bot protection flagged the request
    // fingerprint and refused to stream the body; full Safari form + no Referer + no AE.
    const headers = nhentaiApiHeaders();

    let lastError: any = null;
    let saw404 = false;
    for (const url of candidates) {
      try {
        // SINGLE ATTEMPT: no retry. Rationale: (1) the anonymous search limit is
        // 10 req/min — every retry burns budget and spirals into 429/tarpit;
        // (2) `query=*` + time-ranged sort already takes ~4s server-side, so a
        // single 20s timeout gives the slow query enough headroom.
        const timeoutMs = 20000;
        const response = await proxyService.fetchWithFallback(url, { headers }, timeoutMs);
        if (response.status === 404) {
          saw404 = true;
          console.log(`[BooruAPI] nhentai 404 (sayfa sonu): ${url}`);
          continue;
        }
        if (response.status === 429) {
          // Docs: 10-15 req/min for anonymous IPs. Show a clear error on
          // screen instead of an empty grid.
          throw new Error('nhentai API rate limit exceeded (429 Rate limit). Please wait a bit.');
        }
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          console.log(`[BooruAPI] nhentai HTTP ${response.status}: ${url}`);
          continue;
        }
        const text = await withHardTimeout(response.text(), timeoutMs, 'nhentai body api/v2');
        if (/just a moment|challenge-platform|cf-challenge|attention required/i.test(text.slice(0, 4000))) {
          lastError = new Error('Cloudflare challenge page received');
          console.warn(`[BooruAPI] nhentai returned a bot-wall (challenge) page: ${url}`);
          continue;
        }
        const posts = parseNHentaiV2Listing(text, source);
        console.log(`[BooruAPI] nhentai sonuc=${posts.length} url=${url}`);
        if (posts.length > 0) {
          return await this.filterNHentaiMinScore(
            await this.filterBlacklistedPosts(posts, includeBlacklisted),
            filter
          );
        }
      } catch (err) {
        // The 429 error surfaces directly to the user (not swallowed)
        if (err instanceof Error && err.message.includes('429')) throw err;
        lastError = err;
        console.log(`[BooruAPI] nhentai hata (${err instanceof Error ? err.message : String(err)}): ${url}`);
      }
    }
    if (saw404 && !lastError) {
      return [];
    }
    if (lastError) {
      console.warn('[BooruAPI] nhentai v2 API failed:', lastError);
    }
    return [];
  }

  /**
   * Min favorite threshold: since the server appends `favorites:>=N` to the
   * query it is already filtered in most cases; this client-side pass is the
   * second safety net.
   */
  private filterNHentaiMinScore(posts: BooruPost[], filter?: SearchFilterConfig): BooruPost[] {
    const min = filter?.minScore;
    if (!min || min <= 0 || posts.length === 0) return posts;
    if (!posts.some((p) => (p.score || 0) > 0)) return posts;
    return posts.filter((p) => (p.score || 0) >= min);
  }

  private async fetchXHamsterPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    // XHamster does not understand '-' exclusions; excluded terms are dropped
    const tokens = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !t.startsWith('-'));
    const k = tokens.join(' ');
    void limit;

    // score->views+date, rating->best, height/width->longest, id->newest, default->relevance
    let sort: XHamsterSort = 'relevance';
    let date: XHamsterDate | undefined = undefined;
    const sb = filter?.sortBy;
    if (sb === 'score') {
      sort = 'views';
      date = xhamsterDateForTimeRange(filter?.timeRange);
    } else if (sb === 'rating') {
      sort = 'best';
    } else if (sb === 'height' || sb === 'width') {
      sort = 'longest';
    } else if (sb === 'id') {
      sort = 'newest';
    } else if (sb === 'default' || !sb) {
      sort = 'relevance';
    }

    const candidates = buildXhamsterSearchCandidates(source.baseUrl || XHAMSTER_BASE, page, k, sort, date);
    const headers = {
      'User-Agent': XHAMSTER_UA,
      Referer: `${XHAMSTER_BASE}/`,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    };

    let lastError: Error | null = null;
    let reachedSite = false;
    for (const url of candidates) {
      let response: Response;
      try {
        response = await this.fetchWithRetry(url, { headers }, 1, 10000);
      } catch (e: any) {
        lastError = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      // 404 = try the next candidate; 429/5xx = throw
      if (response.status === 404) {
        lastError = new Error(`XHamster page not found (404): ${url}`);
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('XHamster rate limit exceeded (429 Too Many Requests). Please wait a while.');
        }
        if (response.status >= 500) {
          throw new Error(`XHamster server overloaded (${response.status} ${response.statusText}).`);
        }
        throw new Error(`XHamster error: ${response.status} ${response.statusText}`);
      }

      reachedSite = true;
      const html = await response.text();
      const posts = parseXhamsterListing(html, source);
      if (posts.length > 0) {
        return await this.filterBlacklistedPosts(posts, includeBlacklisted);
      }
      // Empty list: try the next candidate
    }

    if (!reachedSite && lastError) {
      if (lastError.message.includes('(404)')) {
        return [];
      }
      throw lastError;
    }
    return [];
  }

  private phDiscoverCache: BooruPost[] = [];
  private phDiscoverCacheAt = 0;
  /** Wait time after an nhentai v2 API 429 (rate limit: 10-15 req/min) */
  private nhentaiApiCooldownUntil = 0;

  /** Explore cache is valid for 15 min (the grid stays populated even if the site is down). */
  private phDiscoverCacheValid(): boolean {
    return this.phDiscoverCache.length > 0 && Date.now() - this.phDiscoverCacheAt < 15 * 60 * 1000;
  }

  private storePhDiscoverCache(posts: BooruPost[], k: string, page: number): void {
    if (!k && page <= 1 && posts.length > 0) {
      this.phDiscoverCache = posts;
      this.phDiscoverCacheAt = Date.now();
    }
  }

  private async fetchPornhubPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    // The Webmasters API does not understand '-' exclusions; excluded terms are dropped
    const tokens = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !t.startsWith('-'));
    const k = tokens.join(' ');
    void limit;

    // Featured (relevance) in search, mostviewed+daily in explore (dynamic trends)
    let ordering: PornhubOrdering = 'featured';
    let period = pornhubPeriodForTimeRange(filter?.timeRange);

    if (!k) {
      ordering = 'mostviewed';
      if (filter?.timeRange === 'all' || !filter?.timeRange) {
        period = 'daily';
      }
    } else {
      const sb = filter?.sortBy;
      if (sb === 'score') {
        ordering = 'mostviewed';
      } else if (sb === 'rating') {
        ordering = 'rating';
      } else if (sb === 'id') {
        ordering = 'newest';
      } else if (sb === 'height' || sb === 'width') {
        ordering = 'mostviewed';
      } else {
        ordering = 'featured';
      }
    }

    const url = buildPornhubSearchUrl(page, k, ordering, period);
    const htmlHeaders = {
      'User-Agent': PORNHUB_UA,
      Referer: `${PORNHUB_BASE}/`,
    };

    // Explore page 1: the homepage (what the site currently features). On
    // failure it falls back to the API flow below; deeper pages come from the API.
    if (!k && page <= 1) {
      try {
        const homeRes = await this.fetchWithRetry(`${PORNHUB_BASE}/`, {
          headers: htmlHeaders,
        }, 1, 12000);
        if (homeRes.ok) {
          const homeHtml = await homeRes.text();
          const homePosts = parsePornhubHtmlListing(homeHtml, source);
          if (homePosts.length > 0) {
            const out = await this.filterBlacklistedPosts(homePosts, includeBlacklisted);
            this.storePhDiscoverCache(out, k, page);
            return out;
          }
        }
      } catch (homeErr) {
        console.warn('[BooruAPI] Pornhub homepage discover failed, fallback to API:', homeErr);
      }
    }
    const headers = {
      'User-Agent': PORNHUB_UA,
      Referer: `${PORNHUB_BASE}/`,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'application/json',
    };

    let response: Response;
    try {
      response = await this.fetchWithRetry(url, { headers }, 1, 12000);
    } catch (e: any) {
      if (!k && page <= 1 && this.phDiscoverCacheValid()) {
        console.warn('[BooruAPI] Pornhub API unreachable, serving cached discover');
        return this.phDiscoverCache;
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
    if (!response.ok) {
      if (!k && page <= 1 && this.phDiscoverCacheValid()) {
        console.warn(`[BooruAPI] Pornhub API failed (${response.status}), serving cached discover`);
        return this.phDiscoverCache;
      }
      if (response.status === 429) {
        throw new Error('Pornhub rate limit exceeded (429 Too Many Requests). Please wait a while.');
      }
      if (response.status >= 500) {
        throw new Error(`Pornhub server overloaded (${response.status} ${response.statusText}).`);
      }
      throw new Error(`Pornhub error: ${response.status} ${response.statusText}`);
    }

    let rawVideos: PornhubVideo[] = [];
    try {
      const data = await response.json();
      if (data && Array.isArray(data.videos)) {
        rawVideos = data.videos;
      } else if (data && typeof data.code === 'string') {
        console.warn(`[BooruAPI] Pornhub API warning (${data.code}): ${data.message || 'bilinmeyen hata'}`);
      }
    } catch {
      console.warn('[BooruAPI] Pornhub Webmasters API JSON decode failed, fallback to HTML listing');
    }

    const posts: BooruPost[] = [];

    try {
      const htmlSearchUrl = k
        ? `${PORNHUB_BASE}/video/search?search=${encodeURIComponent(k)}&page=${page}`
        : `${PORNHUB_BASE}/video?o=mv&page=${page}`;
      const htmlRes = await this.fetchWithRetry(htmlSearchUrl, {
        headers: {
          'User-Agent': PORNHUB_UA,
          Referer: `${PORNHUB_BASE}/`,
        },
      }, 0, 6000);
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const htmlPosts = parsePornhubHtmlListing(html, source);
        if (htmlPosts.length > 0) {
          const htmlMap = new Map<string, BooruPost>();
          for (const hp of htmlPosts) {
            htmlMap.set(hp.id.replace('ph_', ''), hp);
          }
          for (const v of rawVideos) {
            const post = mapPornhubVideoToPost(v, source);
            if (post) {
              const hp = htmlMap.get(v.video_id);
              if (hp) {
                if (hp.previewVideoUrl) post.previewVideoUrl = hp.previewVideoUrl;
                if ((!post.previewThumbs || post.previewThumbs.length <= 1) && hp.previewThumbs && hp.previewThumbs.length > 1) {
                  post.previewThumbs = hp.previewThumbs;
                  post.previewThumbUrl = hp.previewThumbUrl;
                }
              }
              posts.push(post);
            }
          }
          if (posts.length === 0) {
            posts.push(...htmlPosts);
          }
          const enriched = await this.filterBlacklistedPosts(posts, includeBlacklisted);
          this.storePhDiscoverCache(enriched, k, page);
          return enriched;
        }
      }
    } catch (htmlErr) {
      console.warn('[BooruAPI] Pornhub HTML enrichment failed, fallback to API:', htmlErr);
    }

    for (const v of rawVideos) {
      const post = mapPornhubVideoToPost(v, source);
      if (post) posts.push(post);
    }
    if (posts.length === 0) {
      if (!k && page <= 1 && this.phDiscoverCacheValid()) {
        console.warn('[BooruAPI] Pornhub returned 0 posts, serving cached discover');
        return this.phDiscoverCache;
      }
      throw new Error('Could not load Pornhub videos. Please check your internet connection and try again.');
    }
    const out = await this.filterBlacklistedPosts(posts, includeBlacklisted);
    this.storePhDiscoverCache(out, k, page);
    return out;
  }

  private async fetchCumStPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const o = Math.max(0, (page - 1) * 50);

    let period: string | null = null;
    let dateAnchor: string | null = null;
    let sort: string | null = null;
    let service: string | null = null;
    let mediaType: string | null = null;
    let gender: string | null = null;
    let tagSlug: string | null = null;
    const searchKeywords: string[] = [];

    if (cleanTags) {
      const tokens = cleanTags.split(/\s+/);
      for (const token of tokens) {
        const lower = token.toLowerCase();
        if (lower.startsWith('period:')) {
          period = token.substring(7).trim();
        } else if (lower.startsWith('date:')) {
          dateAnchor = token.substring(5).trim();
        } else if (lower.startsWith('sort:')) {
          sort = token.substring(5).trim();
        } else if (lower.startsWith('service:')) {
          service = token.substring(8).trim();
        } else if (lower.startsWith('type:')) {
          mediaType = token.substring(5).trim();
        } else if (lower.startsWith('gender:')) {
          gender = token.substring(7).trim();
        } else if (lower.startsWith('tag:')) {
          tagSlug = token.substring(4).trim();
        } else if (lower.startsWith('creator:') || lower.startsWith('user:')) {
          const name = token.includes(':') ? token.split(':')[1] : token;
          searchKeywords.push(name.replace(/_/g, ' '));
        } else {
          searchKeywords.push(token.replace(/_/g, ' '));
        }
      }
    }

    let url: string;
    // With a word search always use the generic search endpoint (/api/v1/posts?q=...)!
    // /api/v1/posts/popular is only for wordless pure leaderboard / period searches.
    if (searchKeywords.length === 0 && ((period && ['day', 'week', 'month'].includes(period.toLowerCase())) || dateAnchor)) {
      const queryParams = new URLSearchParams({
        period: period ? period.toLowerCase() : 'day',
        o: String(o),
        n: '50',
      });
      if (dateAnchor) {
        queryParams.append('date', dateAnchor);
      }
      url = `${source.baseUrl}/api/v1/posts/popular?${queryParams.toString()}`;
    } else {
      const queryParams = new URLSearchParams({
        o: String(o),
        n: '50',
      });
      if (sort) queryParams.append('sort', sort);
      if (service && service !== 'all') queryParams.append('service', service);
      if (mediaType && mediaType !== 'all') queryParams.append('type', mediaType);
      if (gender && gender !== 'all') queryParams.append('gender', gender);
      if (tagSlug) queryParams.append('tag', tagSlug);
      if (searchKeywords.length > 0) {
        queryParams.append('q', searchKeywords.join(' '));
      }
      url = `${source.baseUrl}/api/v1/posts?${queryParams.toString()}`;
    }

    let response: Response;
    try {
      response = await fetchBooru(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${source.baseUrl}/`,
          Accept: 'application/json',
        },
      });

      if (!response.ok && response.status >= 500) {
        // Fast retry once for intermittent 500 server errors
        await new Promise((r) => setTimeout(r, 300));
        response = await fetchBooru(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: `${source.baseUrl}/`,
            Accept: 'application/json',
          },
        });
      }
    } catch (e) {
      console.warn('[BooruAPI] Cum.st network error:', e);
      return [];
    }

    if (!response.ok) {
      console.warn(`[BooruAPI] Cum.st API returned status ${response.status}`);
      return [];
    }

    let data: any = null;
    try {
      const text = await response.text();
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[BooruAPI] Failed to parse JSON from Cum.st:', e);
      return [];
    }

    const rawPosts = Array.isArray(data?.posts) ? data.posts : [];
    const result: BooruPost[] = [];

    for (const p of rawPosts) {
      if (!p.attachments || !p.attachments.length) continue;

      for (let i = 0; i < p.attachments.length; i++) {
        const att = p.attachments[i];
        if (!att || !att.sha256) continue;

        const isVideo = att.kind === 'video' || (typeof att.mimeType === 'string' && att.mimeType.startsWith('video/'));
        const ext =
          (typeof att.originalFilename === 'string' ? att.originalFilename.split('.').pop() : '') ||
          (isVideo ? 'mp4' : att.kind === 'gif' ? 'gif' : 'jpg');
        const thumbUrl = ensureAbsoluteUrl(`https://img.cum.st/thumbnail/${att.sha256}/preview.webp`, source.baseUrl);
        const fullMediaUrl = ensureAbsoluteUrl(`https://e1.cum.st/media/${att.sha256}/original.${ext}`, source.baseUrl);

        const width = att.width || 800;
        const height = att.height || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;

        const artist = p.creatorName ? [p.creatorName] : [];
        const copyright = p.service ? [p.service] : [];
        const generalTags = Array.from(
          new Set<string>(
            Array.isArray(p.tags)
              ? p.tags.map((t: any) =>
                  typeof t === 'string' ? t : t && (typeof t.slug === 'string' ? t.slug : typeof t.label === 'string' ? t.label : '')
                ).filter(Boolean)
              : []
          )
        );
        const metaTags = Array.from(
          new Set<string>([att.kind, att.mimeType, p.service, isVideo ? 'video' : 'photo'].filter(Boolean) as string[])
        );

        const allTags = Array.from(new Set<string>([...artist, ...copyright, ...generalTags, ...metaTags]));
        const postScore = Number(p.score !== undefined ? p.score : p.bookmarked) || 0;

        result.push({
          id: p.attachments.length > 1 ? `cumst_${p.id}_${i + 1}` : `cumst_${p.id}`,
          sourceId: source.id,
          sourceName: source.name,
          previewUrl: thumbUrl,
          sampleUrl: fullMediaUrl,
          originalUrl: fullMediaUrl,
          width,
          height,
          aspectRatio,
          rating: 'e',
          score: postScore,
          favCount: postScore,
          tags: {
            artist,
            character: [],
            copyright,
            general: generalTags,
            meta: metaTags,
          },
          allTags,
          sourceLink:
            p.service && p.creatorId
              ? `${source.baseUrl}/creators/${p.service}/${p.creatorId}/post/${p.id}`
              : undefined,
          fileExt: ext,
          fileSize: att.bytes,
          createdAt: p.published
            ? new Date(p.published * 1000).toISOString()
            : p.added
            ? new Date(p.added * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }

    return await this.filterBlacklistedPosts(result, includeBlacklisted);
  }

  async searchTags(query: string, limit: number = 12, source: BooruSource = this.currentSource): Promise<BooruTagSuggestion[]> {
    if (!query || query.trim().length < 2) return [];

    try {
      if (source.id === 'gelbooru') {
        // 1. Preferred: the category-tagged autocomplete2 query that works anonymously
        try {
          const url = `${source.baseUrl}/index.php?page=autocomplete2&term=${encodeURIComponent(query.trim())}&type=tag_query&limit=${limit}`;
          const response = await this.fetchWithRetry(url, {
            headers: { 'User-Agent': USER_AGENT, Referer: `${source.baseUrl}/`, Accept: 'application/json' },
          });
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
              return data
                .slice(0, limit)
                .map((t: any) => {
                  let cat: TagCategory = 'general';
                  if (t.category === 'artist') cat = 'artist';
                  else if (t.category === 'character') cat = 'character';
                  else if (t.category === 'copyright') cat = 'copyright';
                  else if (t.category === 'metadata') cat = 'meta';

                  const rawName = typeof t.value === 'string' ? t.value : typeof t.label === 'string' ? t.label : '';
                  return {
                    name: rawName,
                    category: cat,
                    postCount: parseInt(t.post_count, 10) || 0,
                  };
                })
                .filter((s) => s.name);
            }
          }
        } catch {
          // If autocomplete2 gives no response, switch to the official DAPI Tag List endpoint
        }

        // 2. Official DAPI Tag List fallback from the docs (/index.php?page=dapi&s=tag&q=index)
        try {
          const queryParams = new URLSearchParams({
            page: 'dapi',
            s: 'tag',
            q: 'index',
            json: '1',
            name_pattern: `%${query.trim()}%`,
            orderby: 'count',
            order: 'DESC',
            limit: String(limit),
          });

          const { userId, apiKey } = await StorageService.getGelbooruAuth().catch(() => ({ userId: '', apiKey: '' }));
          if (apiKey.trim() && userId.trim()) {
            queryParams.append('api_key', apiKey.trim());
            queryParams.append('user_id', userId.trim());
          }

          const dapiUrl = `${source.baseUrl}/index.php?${queryParams.toString()}`;
          const dapiRes = await this.fetchWithRetry(dapiUrl, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          });

          if (dapiRes.ok) {
            const data = await dapiRes.json();
            let tagItems: any[] = [];
            if (Array.isArray(data)) {
              tagItems = data;
            } else if (Array.isArray(data?.tag)) {
              tagItems = data.tag;
            } else if (data?.tag && typeof data.tag === 'object') {
              tagItems = [data.tag];
            }

            if (tagItems.length > 0) {
              return tagItems
                .slice(0, limit)
                .map((t: any) => {
                  const typeNum = parseInt(t.type, 10);
                  let cat: TagCategory = 'general';
                  if (typeNum === 1) cat = 'artist';
                  else if (typeNum === 3) cat = 'copyright';
                  else if (typeNum === 4) cat = 'character';
                  else if (typeNum === 5) cat = 'meta';

                  return {
                    name: typeof t.name === 'string' ? t.name : '',
                    category: cat,
                    postCount: parseInt(t.count, 10) || 0,
                  };
                })
                .filter((s) => s.name);
            }
          }
        } catch {}

        return [];
      } else if (source.type === 'redgifs') {
        try {
          // Equivalent of the library's fetch_tag_suggestions (verified live)
          const url = `https://api.redgifs.com/v2/search/suggest?query=${encodeURIComponent(redGifsSearchText(query))}`;
          const response = await this.fetchAuthenticatedRedGifs(url);
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
              return data
                .filter((s: any) => s && typeof s.text === 'string' && s.text)
                .slice(0, limit)
                .map((s: any) => ({
                  name: s.text.toLowerCase().replace(/\s+/g, '_'),
                  category: 'general' as TagCategory,
                  postCount: Number(s.gifs) || 0,
                }));
            }
          }
        } catch {}
        return [];
      } else if (source.type === 'xvideos' || source.type === 'xhamster' || source.type === 'pornhub' || source.type === 'sexcom') {
        // No official suggestion endpoint; a client-side filter is enough
        return [];
      } else if (source.type === 'hentaihaven') {
        return await searchHentaiHavenTags(query, limit);
      } else if (source.type === 'nhentai') {
        return await searchNHentaiTags(query, limit);
      } else if (source.type === 'gelbooru' || source.type === 'realbooru') {
        const url = `${source.baseUrl}/autocomplete.php?q=${encodeURIComponent(query.trim())}`;
        const response = await fetchBooru(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
          .slice(0, limit)
          .map((t: any) => {
            let count = 0;
            if (typeof t.label === 'string') {
              const match = t.label.match(/\((\d+)\)/);
              if (match) count = parseInt(match[1], 10);
            }
            return {
              name: typeof t.value === 'string' ? t.value : typeof t.label === 'string' ? t.label : '',
              category: 'general' as TagCategory,
              postCount: count,
            };
          })
          .filter((s) => s.name);
      } else if (source.type === 'cumst') {
        try {
          const suggestions: BooruTagSuggestion[] = [];
          const lowerQ = query.trim().toLowerCase();

          // 1. Search creators by query (models, artists)
          const creatorsUrl = `${source.baseUrl}/api/v1/creators?q=${encodeURIComponent(query.trim())}&n=${limit}`;
          const cRes = await fetchBooru(creatorsUrl, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          });
          if (cRes.ok) {
            const cData = await cRes.json();
            const creatorsList = Array.isArray(cData.creators) ? cData.creators : [];
            creatorsList.forEach((c: any) => {
              if (c && typeof c.name === 'string' && c.name) {
                suggestions.push({
                  name: c.name,
                  category: 'artist' as TagCategory,
                  postCount: Number(c.bookmarked) || 0,
                });
              }
            });
          }

          // 2. Search tags if suggestions still has capacity
          if (suggestions.length < limit) {
            let tagsList: any[] | null = null;
            if (
              cumStTagsCache &&
              cumStTagsCache.baseUrl === source.baseUrl &&
              Date.now() - cumStTagsCache.at < CUMST_TAGS_CACHE_TTL_MS
            ) {
              tagsList = cumStTagsCache.tags;
            } else {
              const url = `${source.baseUrl}/api/v1/tags`;
              const response = await fetchBooru(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
              });
              if (response.ok) {
                const data = await response.json();
                const fetchedTags: any[] = Array.isArray(data.tags) ? data.tags : [];
                tagsList = fetchedTags;
                cumStTagsCache = { baseUrl: source.baseUrl, tags: fetchedTags, at: Date.now() };
              }
            }
            if (tagsList) {
              const matchedTags = tagsList
                .filter(
                  (t: any) =>
                    (typeof t.slug === 'string' && t.slug.toLowerCase().includes(lowerQ)) ||
                    (typeof t.label === 'string' && t.label.toLowerCase().includes(lowerQ))
                )
                .slice(0, limit - suggestions.length)
                .map((t: any) => ({
                  name: typeof t.slug === 'string' ? t.slug : typeof t.label === 'string' ? t.label : '',
                  category: 'general' as TagCategory,
                  postCount: Number(t.posts) || 0,
                }))
                .filter((s: { name: string }) => s.name);
              suggestions.push(...matchedTags);
            }
          }

          return suggestions;
        } catch {
          return [];
        }
      } else if (source.type === 'danbooru') {
        const url = `${source.baseUrl}/tags.json?search[name_matches]=*${encodeURIComponent(query.trim())}*&search[order]=count&limit=${limit}`;
        const response = await fetchBooru(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
          .map((t: any) => ({
            name: typeof t.name === 'string' ? t.name : '',
            category: mapDanbooruCategory(t.category),
            postCount: Number(t.post_count) || 0,
          }))
          .filter((s) => s.name);
      } else {
        const url = `${source.baseUrl}/tag.json?name=${encodeURIComponent(query.trim())}&order=count&limit=${limit}`;
        const response = await fetchBooru(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
          .map((t: any) => ({
            name: typeof t.name === 'string' ? t.name : '',
            category: 'general' as TagCategory,
            postCount: Number(t.count) || 0,
          }))
          .filter((s) => s.name);
      }
    } catch (e) {
      console.warn('[BooruAPI] Tag autocomplete error:', e);
      return [];
    }
  }
}

export const booruApi = new BooruApiService();
