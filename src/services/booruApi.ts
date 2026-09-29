import { BooruPost, BooruSource, BooruTagGroups, BooruTagSuggestion, RedGifsNiche, RedGifsTrendingTag, TagCategory, SearchFilterConfig } from '../types/booru';
import { asTagList } from '../utils/guards';
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

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/**
 * Abort'e bağlı kalmayan hard-timeout: release build'de abort edilen fetch
 * askıda kalabilir; bu yarış sözü mutlaka sonlandırır (sarkan istek asılı kalır).
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

/** Gelbooru-motoru zamanlı popüler: dönemin ilk post id'si (alt sınır) önbelleği.
 *  Motor tarih filtresi desteklemediği için sınır, son eklenenlerde geriye
 *  yürüyerek bulunur; asıl sorgu `id:>SINIR sort:score:desc` ile sunucuda sıralanır. */
interface GelbooruBoundEntry {
  bound: number | null; // null = pencerede hiç post yok
  at: number;
}
const gelbooruBoundCache = new Map<string, GelbooruBoundEntry>();
const BOUND_CACHE_TTL_MS = 5 * 60 * 1000;
const BOUND_WALK_LIMIT = 100;
const BOUND_MAX_PAGES = 15;

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

/** YYYY-MM-DD (Moebooru date:A..B aralıkları için) */
function formatYMD(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function pastYMD(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatYMD(d);
}

/** TimeRangeOption → gün sayısı (0 = sınırsız) */
export function timeRangeToDays(timeRange: string | undefined): number {
  if (timeRange === '1d') return 1;
  if (timeRange === '1w') return 7;
  if (timeRange === '1m') return 30;
  if (timeRange === '1y') return 365;
  return 0;
}

export class BooruApiService {
  private currentSource: BooruSource = DEFAULT_SOURCE;
  private lastRequestAt = 0;

  setSource(source: BooruSource) {
    this.currentSource = source;
  }

  getSource(): BooruSource {
    return this.currentSource;
  }

  /**
   * Rate-limit koruması + 429/5xx retry: Gelbooru scrape'i banlamasın diye
   * istekler arası min 800ms boşluk, 429/503'te tek seferlik bekleyip tekrar dener.
   * 403 de retry edilir (DPI/bot-duvarı akış-bazlı düşürür, ikinci deneme genelde geçer).
   */
  private async fetchWithRetry(url: string, init?: RequestInit, retries = 1, timeoutMs = 12000): Promise<Response> {
    const now = Date.now();
    const wait = 800 - (now - this.lastRequestAt);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    const attempt = async (): Promise<Response> => {
      this.lastRequestAt = Date.now();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await withHardTimeout(fetchBooru(url, { ...init, signal: ctrl.signal }), timeoutMs, url);
      } finally {
        clearTimeout(t);
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

    // Min Score (RedGifs/XVideos/XHamster/Pornhub'da skor filtresi yok; literal tag olarak gidip sonucu sıfırlar)
    if (filter.minScore && filter.minScore > 0 && activeSource.type !== 'redgifs' && activeSource.type !== 'xvideos' && activeSource.type !== 'xhamster' && activeSource.type !== 'pornhub') {
      parts.push(`score:>=${filter.minScore}`);
    }

    // User / Artist / Creator (RedGifs kullanıcı araması ayrı endpoint'ten yapılır;
    // XVideos/XHamster/Pornhub'da profil sayfası araması yok, kullanıcı adı düz kelime olarak aranır)
    if (filter.user && filter.user.trim()) {
      if (activeSource.type === 'cumst') {
        parts.push(`creator:${filter.user.trim()}`);
      } else if (activeSource.type === 'xvideos' || activeSource.type === 'xhamster' || activeSource.type === 'pornhub') {
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

    // Historical Leaderboard / Anchor Date (Cum.st'e özel; başka motorda
    // literal tag sayılıp sonucu sıfırlar)
    if (filter.leaderboardDate && activeSource.type !== 'xvideos' && activeSource.type !== 'redgifs' && activeSource.type !== 'xhamster' && activeSource.type !== 'pornhub') {
      parts.push(`date:${filter.leaderboardDate.trim()}`);
    }

    // Rating Filter
    if (filter.rating && filter.rating !== 'all') {
      if (activeSource.type === 'danbooru' || activeSource.type === 'moebooru') {
        const map: Record<string, string> = { safe: 'rating:s', questionable: 'rating:q', explicit: 'rating:e' };
        if (map[filter.rating]) parts.push(map[filter.rating]);
      } else if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        const map: Record<string, string> = { safe: 'rating:safe', questionable: 'rating:questionable', explicit: 'rating:explicit' };
        if (map[filter.rating]) parts.push(map[filter.rating]);
      }
    }

    // Sort By & Time Range (RedGifs/XVideos/XHamster/Pornhub sıralaması order=/sort=/ordering
    // parametresiyle kendi fetch fonksiyonları içinde yapılır; buraya order:/sort: token'ı
    // eklenirse literal tag sayılıp sonuç sıfırlanır)
    if (activeSource.type === 'redgifs' || activeSource.type === 'xvideos' || activeSource.type === 'xhamster' || activeSource.type === 'pornhub') {
      return parts.join(' ').trim();
    }
    if (filter.sortBy === 'score') {
      if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        // Gelbooru motoru yalnızca toplam skora göre sıralar; zaman aralığı
        // fetchGelbooruPosts içinde alt-sınır id'sine (`id:>X`) çevrilir.
        parts.push('sort:score:desc');
      } else if (activeSource.type === 'danbooru') {
        // 'age:1w' tam 1 haftalıkları getirir; aralık için '<' gerekir (canlı doğrulandı)
        if (filter.timeRange === '1d') {
          parts.push('age:<1day', 'order:score');
        } else if (filter.timeRange === '1w') {
          parts.push('age:<1week', 'order:score');
        } else if (filter.timeRange === '1m') {
          parts.push('age:<1month', 'order:score');
        } else if (filter.timeRange === '1y') {
          parts.push('age:<1year', 'order:score');
        } else {
          parts.push('order:rank');
        }
      } else if (activeSource.type === 'moebooru') {
        // 'date:today' gibi anahtar kelimeler çalışmıyor (boş dönüyor, canlı doğrulandı);
        // date:BAŞLANGIÇ..BİTİŞ aralığı çalışıyor
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

      // 1b. RedGifs niches — 'niche:<id>' kara liste girdileriyle eşleşir
      if (post.niches) {
        for (let i = 0; i < post.niches.length; i++) {
          const nid = post.niches[i]?.trim().toLowerCase();
          if (nid && blacklistSet.has(`niche:${nid}`)) return false;
        }
      }

      // 1c. RedGifs kullanıcıları — 'user:<ad>' kara liste girdileri sanatçıyla eşleşir
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
    limit: number = 20
  ): Promise<BooruPost[]> {
    const queryTags = this.buildQueryTags(filter);
    return await this.fetchPosts(page, limit, queryTags, filter);
  }

  async fetchPosts(
    page: number = 1,
    limit: number = 20,
    tags: string = '',
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    const source = this.currentSource;
    const includeBlacklisted = filter?.includeBlacklisted ?? false;

    try {
      if (source.id === 'gelbooru') {
        // Anahtarlı DAPI 401 verirse (yanlış/eksik anahtar) scrape'e düşme:
        // kullanıcıya anahtarın geçersiz olduğunu göster ki düzeltebilsin
        const { userId, apiKey } = await StorageService.getGelbooruAuth().catch(() => ({ userId: '', apiKey: '' }));
        if (userId.trim() && apiKey.trim()) {
          return await this.fetchGelbooruPosts(source, page, limit, tags, includeBlacklisted, filter);
        }
        try {
          return await this.fetchGelbooruPosts(source, page, limit, tags, includeBlacklisted, filter);
        } catch {
          return await this.fetchGelbooruScrapedPosts(source, page, limit, tags, includeBlacklisted);
        }
      } else if (source.type === 'gelbooru') {
        return await this.fetchGelbooruPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'moebooru') {
        return await this.fetchMoebooruPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'realbooru') {
        return await this.fetchRealbooruPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'cumst') {
        return await this.fetchCumStPosts(source, page, limit, tags, includeBlacklisted);
      } else if (source.type === 'redgifs') {
        const posts = await this.fetchRedGifsPosts(source, page, limit, tags, filter);
        // Keşfet akışında (etiketsiz) sayfa çakışmalarını eler: trending
        // sayfaları aynı gönderileri tekrarlayabiliyor. Arama sonuçları
        // etkilenmez.
        const isFeed = !tags.trim() && !(filter && (filter.tags.length > 0 || filter.user?.trim()));
        if (!isFeed) return posts;
        const fresh = posts.filter((p) => !this.feedSeenIds.has(p.id));
        fresh.forEach((p) => this.feedSeenIds.add(p.id));
        return fresh;
      } else if (source.type === 'xvideos') {
        return await this.fetchXVideosPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'xhamster') {
        return await this.fetchXHamsterPosts(source, page, limit, tags, includeBlacklisted, filter);
      } else if (source.type === 'pornhub') {
        return await this.fetchPornhubPosts(source, page, limit, tags, includeBlacklisted, filter);
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
        throw new Error('Gelbooru web istek sınırı aşıldı (429 Too Many Requests). Lütfen bir süre bekleyin.');
      }
      if (response.status >= 500) {
        throw new Error(`Gelbooru web sunucusu aşırı yüklendi (${response.status} ${response.statusText}).`);
      }
      throw new Error(`Gelbooru hatası: ${response.status} ${response.statusText}`);
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

      // Liste HTML'inde boyut yok; gerçek ölçüler post sayfasındadır.
      // width/height placeholder (800x1000) bırakılır, Info modalı açıldığında
      // gerçek değerler doldurulur (resolveRealDimensions).
      const width = 800;
      const height = 1000;

      let rawOriginal = thumbSrc;
      let rawSample = thumbSrc;
      let fileExt = 'jpg';

      const imgPattern = /https:\/\/([a-z0-9]+)\.gelbooru\.com\/thumbnails\/([a-f0-9]+)\/([a-f0-9]+)\/thumbnail_([a-f0-9]+)\.([a-z0-9]+)/i;
      const imgMatch = thumbSrc.match(imgPattern);

      if (imgMatch) {
        const [, sub, dir1, dir2, hash, thumbnailExt] = imgMatch;
        // Thumbnail uzantısı original ile aynı değildir. Gelbooru özellikle
        // JPEG original'ları thumbnail/sample için .jpg, original için .jpeg
        // verir; .jpg tahmini 404/hotlink redirect ile sonuçlanır.
        // Scrape yolunda gerçek uzantıyı post sayfasından çözene dek sample
        // güvenilir fallback'tir; original'i ancak DAPI gerçek file_url ile verir.
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
      // Dönemin alt sınır id'sini bul, sonra popülerleri sunucuda sıralat.
      // Yürüyüş id-desc yapılır; tarih için `change` alanı kullanılır
      // (son düzenleme zamanıdır, yükleme değil — sınıra yakın postlarda +- sapma olur).
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

  /** Son eklenenlerde geriye yürü, tarih eşiğine giren en küçük id'yi döndür */
  private async resolveGelbooruLowerBound(
    source: BooruSource,
    walkTags: string,
    windowDays: number
  ): Promise<number | null> {
    const key = `${source.id}|${walkTags}|${windowDays}`;
    const now = Date.now();
    const cached = gelbooruBoundCache.get(key);
    if (cached && now - cached.at < BOUND_CACHE_TTL_MS) return cached.bound;

    const cutoff = now - windowDays * 86400000;
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
      // Sayfanın en eski (son) postu eşikten eskiyse daha geriye gitme
      const lastT = new Date(batch[batch.length - 1].createdAt).getTime();
      if (Number.isFinite(lastT) && lastT < cutoff) break;
    }
    gelbooruBoundCache.set(key, { bound, at: now });
    return bound;
  }

  private async fetchGelbooruPage(
    source: BooruSource,
    pid: number,
    limit: number,
    cleanTags: string,
    includeBlacklisted: boolean = false
  ): Promise<BooruPost[]> {
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
    // Kullanıcının kendi Gelbooru anahtarı (Doküman sırası: &api_key=...&user_id=...)
    if (source.id === 'gelbooru') {
      try {
        const { userId, apiKey } = await StorageService.getGelbooruAuth();
        if (apiKey.trim() && userId.trim()) {
          queryParams.append('api_key', apiKey.trim());
          queryParams.append('user_id', userId.trim());
        }
      } catch {}
    }

    const url = `${source.apiBaseUrl || source.baseUrl}/index.php?${queryParams.toString()}`;
    const response = await this.fetchWithRetry(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Gelbooru API kimlik doğrulaması gerekiyor (401 Unauthorized). Lütfen Ayarlar sayfasından API anahtarınızı (api_key ve user_id) tanımlayın.');
      }
      if (response.status === 429) {
        throw new Error('Gelbooru istek sınırı aşıldı (429 Too Many Requests). Lütfen birkaç saniye bekleyin veya API anahtarınızı tanımlayın.');
      }
      if (response.status >= 500) {
        throw new Error(`Gelbooru sunucusu aşırı yüklendi veya arama sorgusu zaman aşımına uğradı (${response.status} ${response.statusText}).`);
      }
      throw new Error(`Gelbooru API hatası: ${response.status} ${response.statusText}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error('Gelbooru API geçerli bir JSON yanıtı döndürmedi (sunucu aşırı yüklü veya arama tamamlanamadı).');
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
    // Realbooru sayfa başına 42 post listeler (pid=0, 42, 84, ...)
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

      const isVideo =
        rawThumb.endsWith('.mp4') ||
        rawThumb.endsWith('.webm') ||
        rawTags.some((t) => ['video', 'webm', 'mp4', 'sound', 'animated'].includes(t.toLowerCase()));

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

      let fileExt = verifiedExt || (isVideo ? 'mp4' : 'jpg');

      let rawOriginal = '';
      let rawSample = rawThumb;

      if (verifiedOriginalUrl) {
        rawOriginal = verifiedOriginalUrl;
        rawSample = verifiedOriginalUrl;
      } else if (isVideo && thumbMatch) {
        const [, dir1, dir2, hash] = thumbMatch;
        rawOriginal = `${source.baseUrl}/images/${dir1}/${dir2}/${hash}.mp4`;
        rawSample = rawOriginal;
      } else {
        // Thumbnail uzantısından original uzantısı türetilmez (jpeg tahmini 404 üretir).
        // Scrape aşamasında verified url yoksa sample preview'da kalır,
        // original ise viewer'da resolveGelbooruOriginalUrl ile post sayfasından çözülür.
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
  /** Keşfet akışında gösterilmiş gönderi id'leri (sayfa çakışmalarını eler). */
  private feedSeenIds = new Set<string>();

  private async fetchRedGifsApi(url: string, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Origin: 'https://www.redgifs.com',
      Referer: 'https://www.redgifs.com/',
      Accept: 'application/json',
      'Cache-Control': 'no-store, no-cache',
    };
    if (token) {
      // RedGifs tek başlık bekliyor; üç varyantı birden göndermek WAF'a
      // kırmaya çalışan bir dolambaçtı.
      headers['Authorization'] = `Bearer ${token}`;
    }
    return await this.fetchWithRetry(url, { headers }, 0, 10000);
  }

  private async getRedGifsToken(rejectedToken?: string): Promise<string> {
    await proxyService.ensureInitialized();
    const scope = proxyService.isEnabled() ? proxyService.getWorkerUrl() : 'direct';
    // Geç gelen başka bir 401, daha yeni ve geçerli token'ı silemez.
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

    // Token gönderen bağlantıya bağlıdır. Diske yazıp başka açılışta/IP'de
    // kullanma: 401 sonrası aynı kayıt tekrar okunarak WrongSender döngüsü oluşuyordu.
    const id = Symbol(scope);
    const promise = (async () => {
      const authRes = await this.fetchRedGifsApi('https://api.redgifs.com/v2/auth/temporary');
      if (!authRes.ok) {
        const errText = await authRes.text().catch(() => '');
        throw new Error(`RedGifs auth başarısız (${authRes.status}): ${errText}`);
      }
      const data = await authRes.json();
      if (typeof data?.token !== 'string' || !data.token) {
        throw new Error('RedGifs token alınamadı (boş yanıt)');
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
    // Bir yenileme hakkı: kalıcı ağ/proxy sorunu sonsuz auth döngüsü oluşturmaz.
    return this.fetchRedGifsApi(url, refreshed);
  }

  /**
   * RedGifs token'ını arka planda hazırlar. Uygulama açılışında çağrılır:
   * Keşfet ekranı auth turunu beklemez.
   */
  async warmupRedGifs(): Promise<void> {
    try {
      await this.getRedGifsToken();
    } catch (e) {
      console.warn('[BooruAPI] RedGifs warmup başarısız:', e);
    }
  }

  /** Keşfet akışı yeniden başlatılırken (kaynak/sıra değişimi, pull-to-refresh). */
  resetFeedSeen(): void {
    this.feedSeenIds.clear();
  }

  private async fetchRedGifsPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    let cleanTags = tags.trim();
    // Eğer tags içinde rating filtresi vs yoksa ve doğrudan etiket araması yapılıyorsa
    // filter.tags varsa onu da kontrol et
    if (!cleanTags && filter?.tags && filter.tags.length > 0) {
      cleanTags = filter.tags.map((t) => t.trim()).filter(Boolean).join(' ');
    }

    // RedGifs '-tag' dışlama sözdizimini bilmez; dahil/hariç ayrımı yapılıp
    // hariç tutulanlar sunucuya gönderilmeden istemcide filtrelenir
    const normTag = (t: string) => t.toLowerCase().replace(/\s+/g, '_');
    const tokens = cleanTags.split(/\s+/).filter(Boolean);
    const excludeTags = tokens.filter((t) => t.startsWith('-')).map((t) => normTag(t.replace(/^-+/, ''))).filter(Boolean);
    // '-niche:<id>' dışlamaları post.niches ile eşleşir
    const nicheExcludes = excludeTags
      .filter((t) => t.startsWith('niche:'))
      .map((t) => t.substring(6).trim())
      .filter(Boolean);
    // '-user:<ad>' dışlamaları post.tags.artist ile eşleşir
    const userExcludes = excludeTags
      .filter((t) => t.startsWith('user:'))
      .map((t) => t.substring(5).trim().toLowerCase())
      .filter(Boolean);
    const includeTokens = tokens
      .filter((t) => !t.startsWith('-'))
      .filter((t) => !t.toLowerCase().startsWith('user:'));
    // 'user:<ad>' yazımı filtredeki Kullanıcı alanıyla aynı mekanikle çalışır
    const userToken = tokens.find((t) => !t.startsWith('-') && t.toLowerCase().startsWith('user:'));
    const tokenUsername = userToken ? userToken.substring(5).trim() : '';
    // Sunucuya ham yazımıyla gider: RedGifs kısmi eşleşme yapar ('ana' -> 'anal'),
    // '_' ile yarım kalan çok kelimeli etikette ('big_t') 0 döner.
    const includeTags = includeTokens.map((t) => t.trim()).filter(Boolean).join(' ');

    // Sıralama belirleme (RedGifs Order değerleri: trending, latest, score, top7, top28, top)
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
    // Niche (kategori) araması: 'niche:<id>' token'ı görülürse kütüphanedeki
    // kategori mantığı karşılığı /v2/niches/{id}/gifs kullanılır (canlı doğrulandı).
    // Bu endpoint tags almaz; kalan etiketler istemcide filtrelenir.
    const nicheToken = includeTokens.find((t) => t.toLowerCase().startsWith('niche:'));
    const nicheId = nicheToken ? nicheToken.substring(6).trim() : '';
    const remainingTokens = nicheId ? includeTokens.filter((t) => t !== nicheToken) : includeTokens;
    const remainingTags = remainingTokens.map((t) => t.trim()).filter(Boolean).join(' ');
    // Kullanıcı/üretici araması: filtredeki Kullanıcı alanı veya 'user:<ad>' yazımı
    // (kütüphanedeki search_user karşılığı, canlı doğrulandı).
    // Not: bu endpoint order=trending ile boş döner (latest zorunlu) ve tags parametresini
    // desteklemez (tags eklenirse 0 döner); kullanıcı+etiket birlikteyse etiketler istemcide filtrelenir.
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
        throw new Error(`RedGifs kullanıcısı bulunamadı: ${searchUsername}`);
      }
      if (response.status === 404 && nicheId) {
        throw new Error(`RedGifs kategorisi bulunamadı: ${nicheId}`);
      }
      throw new Error(`RedGifs API hatası (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const gifs = Array.isArray(data.gifs) ? data.gifs : [];

    const posts = this.mapRedGifsGifs(source, gifs);

    // İstemci tarafı filtreleme: kullanıcı/niche+etiket birlikteliğinde veya '-tag'
    // dışlamalarında sunucu filtrelemez; burada elenir
    const filterTokens = nicheId ? remainingTokens : includeTokens;
    const needsClientFilter =
      excludeTags.length > 0 || ((searchUsername || nicheId) && filterTokens.length > 0);
    if (!needsClientFilter) return posts;

    const includeNorm = filterTokens.map(normTag).filter(Boolean);
    return posts.filter((p) => {
      const hay = p.allTags.map(normTag);
      if (excludeTags.some((t) => hay.includes(t))) return false;
      if ((searchUsername || nicheId) && includeNorm.some((t) => !hay.includes(t))) return false;
      // '-niche:<id>' dışlaması: bu kategorideki gönderiyi ele
      if (nicheExcludes.length > 0 && p.niches?.some((n) => nicheExcludes.includes(normTag(n)))) return false;
      // '-user:<ad>' dışlaması: bu hesabın gönderisini ele
      if (userExcludes.length > 0 && p.tags.artist?.some((a) => userExcludes.includes(a.trim().toLowerCase()))) return false;
      return true;
    });
  }

  /** RedGifs API'sinden gelen ham gif kayıtlarını BooruPost'a çevirir. */
  private mapRedGifsGifs(source: BooruSource, gifs: any[]): BooruPost[] {
    return gifs.map((g: any) => {
      const hdUrl = g.urls?.hd || '';
      const sdUrl = g.urls?.sd || '';
      const silentUrl = g.urls?.silent || '';
      const fullVideo = hdUrl || sdUrl || silentUrl;
      const previewThumb = g.urls?.thumbnail || g.urls?.poster || '';
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
   * RedGifs trend arama terimleri: `/v2/tags/trending` → `{tags:[{name,count}]}`
   * (canlı doğrulandı). Sabit trending akışını çeşitlendiren yüzey; etiketler
   * günlük değişir. 30 dakika bellek cache'i — her açılışta bir istek.
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
        // Satır boş kalır, akış çalışmaya devam eder
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
      console.warn('[BooruAPI] RedGifs trending tags hatası:', e);
      return [];
    }
  }

  /**
   * RedGifs niches (kategoriler): query boşsa trendler, doluysa arama.
   * Kütüphanede doğrudan karşılığı yok; /v2/niches uçları canlı doğrulandı.
   */
  async fetchRedGifsNiches(query?: string): Promise<RedGifsNiche[]> {
    const q = query?.trim();
    const url = q
      ? `https://api.redgifs.com/v2/niches?query=${encodeURIComponent(q)}`
      : 'https://api.redgifs.com/v2/niches/trending?page=1&count=20';
    const response = await this.fetchAuthenticatedRedGifs(url);
    if (!response.ok) {
      // Sözleşme [] döndürür (niş yok gibi görünür); tanılama için logla
      console.warn(`[BooruAPI] RedGifs niches HTTP ${response.status}, boş liste dönülüyor`);
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
   * XVideos `/best` güncel ayını (`YYYY-AA`) çözer (6 saat cache).
   * Sayfa-1 `/best` redirect'i ayı kendisi bulur; deeper keşfet sayfaları
   * için aydan türetilmiş URL gerekir. Bulunamazsa '' döner ve keşfet
   * `/new` varyantlarına düşer.
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
      // yok say: /new fallback'i devrede
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
    // XVideos '-' dışlama sözdizimini anlamaz; hariç tutulanlar atılır
    // (liste kartlarında etiket verisi yok, istemcide filtrelenemez).
    const tokens = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !t.startsWith('-'));
    const k = tokens.join(' ');
    void limit;

    // Sıralama eşlemesi (sitenin sort parametreleri: relevance, uploaddate,
    // rating, length, views, random). 'user' sort'unun site karşılığı yok.
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

    const bestMonth = !k && page > 1 ? await this.resolveXVideosBestMonth(source.baseUrl || XVIDEOS_BASE) : this.xvideosBestMonth;
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
      // 404 = yanlış sayfa varyantı, sonraki adayı dene; diğerleri gerçek hata
      if (response.status === 404) {
        lastError = new Error(`XVideos sayfası bulunamadı (404): ${url}`);
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('XVideos istek sınırı aşıldı (429 Too Many Requests). Lütfen bir süre bekleyin.');
        }
        if (response.status >= 500) {
          throw new Error(`XVideos sunucusu aşırı yüklendi (${response.status} ${response.statusText}).`);
        }
        throw new Error(`XVideos hatası: ${response.status} ${response.statusText}`);
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
      // Boş liste: aday varyantı yanlış olabilir, sonrakini dene
    }

    // Siteye hiç ulaşılamadıysa (ağ hatası / tüm adaylar 404) son hatayı
    // fırlat; aksi halde gerçekten sonuç yok (liste sonu) → []
    if (!reachedSite && lastError) throw lastError;
    return [];
  }

  private async fetchXHamsterPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string,
    includeBlacklisted: boolean = false,
    filter?: SearchFilterConfig
  ): Promise<BooruPost[]> {
    // XHamster '-' dışlama sözdizimini anlamaz; hariç tutulanlar atılır
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
      // 404 = sonraki adayı dene; 429/5xx = fırlat
      if (response.status === 404) {
        lastError = new Error(`XHamster sayfası bulunamadı (404): ${url}`);
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('XHamster istek sınırı aşıldı (429 Too Many Requests). Lütfen bir süre bekleyin.');
        }
        if (response.status >= 500) {
          throw new Error(`XHamster sunucusu aşırı yüklendi (${response.status} ${response.statusText}).`);
        }
        throw new Error(`XHamster hatası: ${response.status} ${response.statusText}`);
      }

      reachedSite = true;
      const html = await response.text();
      const posts = parseXhamsterListing(html, source);
      if (posts.length > 0) {
        return await this.filterBlacklistedPosts(posts, includeBlacklisted);
      }
      // Boş liste: sonraki adayı dene
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

  /** Keşfet önbelleği 15dk geçerli (site düşse bile grid boş kalmaz). */
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
    // Webmasters API '-' dışlama sözdizimini anlamaz; hariç tutulanlar atılır
    const tokens = tags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !t.startsWith('-'));
    const k = tokens.join(' ');
    void limit;

    // Aramada featured (alaka), keşfette mostviewed+daily (dinamik trendler)
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

    // Keşfet sayfa 1: anasayfa (sitenin o an öne çıkardıkları). Başarısız
    // olursa aşağıdaki API akışına düşülür; deeper sayfalar API'den gelir.
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
        throw new Error('Pornhub istek sınırı aşıldı (429 Too Many Requests). Lütfen bir süre bekleyin.');
      }
      if (response.status >= 500) {
        throw new Error(`Pornhub sunucusu aşırı yüklendi (${response.status} ${response.statusText}).`);
      }
      throw new Error(`Pornhub hatası: ${response.status} ${response.statusText}`);
    }

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      throw new Error('Pornhub yanıtı çözümlenemedi.');
    }
    // Hata gövdesi: {"code":"1001",...} (kütüphanenin check_response karşılığı)
    if (data && typeof data.code === 'string') {
      throw new Error(`Pornhub API hatası (${data.code}): ${data.message || 'bilinmeyen hata'}`);
    }
    const rawVideos: PornhubVideo[] = Array.isArray(data?.videos) ? data.videos : [];
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
          const mbMap = new Map<string, string>();
          for (const hp of htmlPosts) {
            if (hp.previewVideoUrl) {
              mbMap.set(hp.id.replace('ph_', ''), hp.previewVideoUrl);
            }
          }
          for (const v of rawVideos) {
            const post = mapPornhubVideoToPost(v, source);
            if (post) {
              const mb = mbMap.get(v.video_id);
              if (mb) {
                post.previewVideoUrl = mb;
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
      console.warn('[BooruAPI] Pornhub HTML mediabook enrichment failed, fallback to API:', htmlErr);
    }

    for (const v of rawVideos) {
      const post = mapPornhubVideoToPost(v, source);
      if (post) posts.push(post);
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
    // Kelime araması varsa, daima genel arama (/api/v1/posts?q=...) endpoint'i kullanılmalı!
    // /api/v1/posts/popular sadece kelimesiz saf liderlik tablosu / periyot aramalarında kullanılmalı.
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

    return result;
  }

  async searchTags(query: string, limit: number = 12): Promise<BooruTagSuggestion[]> {
    if (!query || query.trim().length < 2) return [];

    const source = this.currentSource;
    try {
      if (source.id === 'gelbooru') {
        // 1. Öncelikli: Kategori etiketli ve anonim çalışan autocomplete2 sorgusu
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
          // autocomplete2 yanıt vermezse resmi DAPI Tag List endpoint'ine geç
        }

        // 2. Dokümandaki resmi DAPI Tag List fallback (/index.php?page=dapi&s=tag&q=index)
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
          // Kütüphanedeki fetch_tag_suggestions karşılığı (canlı doğrulandı)
          const url = `https://api.redgifs.com/v2/search/suggest?query=${encodeURIComponent(query.trim())}`;
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
      } else if (source.type === 'xvideos' || source.type === 'xhamster' || source.type === 'pornhub') {
        // Resmi öneri endpoint'i yok; istemci tarafı filtre yeterli
        return [];
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
            const url = `${source.baseUrl}/api/v1/tags`;
            const response = await fetchBooru(url, {
              headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            });
            if (response.ok) {
              const data = await response.json();
              const tagsList = Array.isArray(data.tags) ? data.tags : [];
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
