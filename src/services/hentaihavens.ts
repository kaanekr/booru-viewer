import type { BooruPost, BooruSource, BooruTagSuggestion, TagCategory } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * HentaiHaven (https://hentaihaven.xxx / https://api.hentaihaven.app/v1) entegrasyonu.
 * - Birincil: Haniversity/hhaven standardında resmi mobil REST API (api.hentaihaven.app/v1).
 *   /warden token yetkilendirmesi, /hentai/all, /search?q=..., /genre/..., /hentai/{id}.
 *   Bölüm stream URL'leri (m3u8) doğrudan `chapter_content` alanında gelir.
 * - İkincil / Yedek: SSR HTML ayrıştırma (Cloudflare veya ağ hatasında güvenlik ağı).
 * React importu YOK - node ile doğrudan test edilebilir.
 */

export const HENTAIHAVEN_BASE = 'https://hentaihaven.xxx';
export const HENTAIHAVEN_API_BASE = 'https://api.hentaihaven.app/v1';

export const HENTAIHAVEN_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
export const HENTAIHAVEN_APP_UA = 'HH_xxx_APP';

const WARDEN_BODY =
  'sdkInt=33&board=goldfish_x86_64&brand=google&display=sdk_gphone_x86_64-userdebug+13+TE1A.220922.028+10190541+dev-keys&fingerprint=google%2Fsdk_gphone_x86_64%2Femu64xa%3A13%2FTE1A.220922.028%2F10190541%3Auserdebug%2Fdev-keys&manufacturer=Google&model=sdk_gphone_x86_64';

let cachedWardenToken: string | null = null;
let wardenPromise: Promise<string> | null = null;

/**
 * Cloudflare korumalı Hentai Haven API için warden token alır.
 * Token aylarca geçerlidir; eşzamanlı istekler tek bir sorguda toplanır (single-flight).
 */
export async function getHentaiHavenToken(forceRefresh: boolean = false): Promise<string> {
  if (cachedWardenToken && !forceRefresh) return cachedWardenToken;
  if (wardenPromise) return wardenPromise;

  wardenPromise = (async () => {
    try {
      const res = await fetch(`${HENTAIHAVEN_API_BASE}/warden`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'User-Agent': HENTAIHAVEN_APP_UA,
        },
        body: WARDEN_BODY,
      });

      if (!res.ok) {
        throw new Error(`Warden token alınamadı (HTTP ${res.status})`);
      }

      const json = await res.json();
      const token = json?.data?.token;
      if (!token || typeof token !== 'string') {
        throw new Error('Warden cevabında geçerli token bulunamadı');
      }

      cachedWardenToken = token;
      return token;
    } finally {
      wardenPromise = null;
    }
  })();

  return wardenPromise;
}

/**
 * Resmi v1 API isteği atar. 401 veya 502 durumunda tokenı yenileyip
 * tek seferlik yeniden dener.
 */
export async function fetchHentaiHavenApi<T = any>(
  path: string,
  options: RequestInit = {},
  ms: number = 15000,
  signal?: AbortSignal
): Promise<T> {
  let token = await getHentaiHavenToken();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  const makeReq = async (tok: string) => {
    return await fetch(`${HENTAIHAVEN_API_BASE}/${path}`, {
      ...options,
      headers: {
        'User-Agent': HENTAIHAVEN_APP_UA,
        warden: tok,
        Accept: 'application/json',
        ...(options.headers || {}),
      },
      signal: ctrl.signal,
    });
  };

  try {
    let res = await makeReq(token);

    // Token geçersizse temizle ve bir kez yenile
    if (res.status === 401 || res.status === 502) {
      token = await getHentaiHavenToken(true);
      res = await makeReq(token);
    }

    clearTimeout(timeout);

    if (res.status === 429) {
      throw new Error('HentaiHaven istek sınırı aşıldı (429 Rate limit). Lütfen biraz bekleyin.');
    }
    if (!res.ok) {
      throw new Error(`HentaiHaven API hatası: HTTP ${res.status}`);
    }

    const json = await res.json();
    return json?.data as T;
  } catch (e: any) {
    clearTimeout(timeout);
    throw e;
  }
}

/** 'School Girl' -> 'school-girl'; eslesmeyen karakterler atilir. */
export function hentaiHavenTagSlug(query: string | undefined): string {
  const slug = (query || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

export function buildHentaiHavenSearchCandidates(
  baseUrl: string,
  page: number,
  keyword: string
): string[] {
  const base = (baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');
  const k = (keyword || '').trim();
  if (!k) {
    if (page <= 1) return [base + '/browse/trending/'];
    return [base + '/browse/trending/page/' + page + '/'];
  }
  const slug = hentaiHavenTagSlug(k);
  if (!slug) return [];
  if (page <= 1) return [base + '/tag/' + slug + '/'];
  return [base + '/tag/' + slug + '/page/' + page + '/'];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, String.fromCharCode(39))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** '681,000' / '1.3M' bicimi izlenme metnini sayiya cevirir. */
export function parseHentaiHavenCount(raw: string | undefined): number {
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
 * Liste HTML'inden (ana sayfa / trending / tag) seri kartlarini cikarir.
 */
export function parseHentaiHavenListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!html) return posts;
  const seen = new Set<string>();
  const base = (source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');

  const chunks = html.split('aspect-[2/3]');
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];

    const slugM = c.match(/href="\/watch\/([a-z0-9-]+)\/"/);
    if (!slugM) continue;
    const slug = slugM[1];
    if (seen.has(slug)) continue;

    const titleM =
      c.match(/<img[^>]*alt="([^"]+)"/i) || c.match(/aria-label="([^"]+)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';
    const posterM = c.match(/src="(https:\/\/img\.hentaihaven\.xxx\/[^"]+)"/);
    const poster = posterM ? posterM[1].trim() : '';
    if (!poster) continue;

    const viewsM = c.match(/aria-label="([\d,\.]+[KMB]?) views"/i);
    const views = viewsM ? parseHentaiHavenCount(viewsM[1]) : 0;

    seen.add(slug);
    posts.push({
      id: 'hh_' + slug,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: poster,
      previewVideoUrl: undefined,
      previewThumbUrl: undefined,
      previewThumbs: undefined,
      sampleUrl: poster,
      originalUrl: '',
      width: 600,
      height: 900,
      aspectRatio: 2 / 3,
      rating: 'e',
      score: views,
      favCount: views,
      tags: {
        artist: [],
        character: [],
        copyright: [],
        general: [],
        meta: ['video'],
      },
      allTags: [],
      sourceLink: base + '/watch/' + slug + '/',
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  return posts;
}

export interface HentaiHavenEpisode {
  ep: number;
  url: string;
  name?: string;
  streamUrl?: string;
  previewUrl?: string;
  thumbnail?: string;
  chapterId?: number;
}

/**
 * Seri sayfasindan bolumleri cikarir (en yeni ilk).
 */
export function parseHentaiHavenEpisodes(html: string, seriesUrl: string): HentaiHavenEpisode[] {
  const eps: HentaiHavenEpisode[] = [];
  if (!html || !seriesUrl) return eps;
  const seriesM = seriesUrl.match(/\/watch\/([a-z0-9-]+)\//i);
  if (!seriesM) return eps;
  const prefix = '/watch/' + seriesM[1].toLowerCase() + '/episode-';
  const seen = new Set<string>();
  const re = /href="(\/watch\/[a-z0-9-]+\/episode-(\d+)\/)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href.toLowerCase().startsWith(prefix)) continue;
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    eps.push({ ep: parseInt(m[2], 10), url: href });
  }
  eps.sort((a, b) => b.ep - a.ep);
  return eps;
}

export interface HentaiHavenFiles {
  hls: string;
  mp4: string;
  thumb: string;
  durationSec?: number;
  episodes?: HentaiHavenEpisode[];
  tags?: BooruPost['tags'];
  allTags?: string[];
  views?: number;
  rating?: { rating: string | number; votes: number };
  description?: string;
}

/**
 * Cloudflare yönetilen doğrulama sayfası tespiti.
 */
export function isChallengeHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return (
    html.includes('_cf_chl_opt') ||
    html.includes('challenge-error-text') ||
    html.includes('Enable JavaScript and cookies to continue')
  );
}

/** Kaçışlı gömülü URL'leri normalize eder (\/, \u0026). */
function unescapeUrl(u: string): string {
  return u
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Bolum detay HTML'inden oynatilabilir dosyayi ayiklar (Yedek HTML yolu).
 */
export function parseHentaiHavenEpisodeDetail(html: string): HentaiHavenFiles {
  const out: HentaiHavenFiles = { hls: '', mp4: '', thumb: '' };
  if (!html) return out;

  const ldBlocks: string[] = [];
  const ldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = ldRe.exec(html)) !== null) ldBlocks.push(lm[1]);
  const scopes = ldBlocks.length > 0 ? ldBlocks : [html];
  for (const scope of scopes) {
    const hlsM = scope.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
    if (hlsM) {
      const url = unescapeUrl(hlsM[1]);
      if (/\.m3u8/i.test(url.split('?')[0])) {
        out.hls = url;
        break;
      }
      if (!out.mp4 && /\.mp4/i.test(url.split('?')[0])) out.mp4 = url;
    }
  }

  if (!out.hls) {
    const anyM = html.match(/https?:[^"'\s\\]*?\.m3u8[^"'\s\\]*/i);
    if (anyM) out.hls = unescapeUrl(anyM[0]);
  }

  if (!out.hls && !out.mp4) {
    const srcM =
      html.match(/<source[^>]+src="([^"]+\.mp4[^"]*)"/i) ||
      html.match(/<video[^>]+src="([^"]+\.mp4[^"]*)"/i) ||
      html.match(/file\s*:\s*"([^"]+\.mp4[^"]*)"/i);
    if (srcM) out.mp4 = unescapeUrl(decodeEntities(srcM[1]));
  }

  const scope0 = scopes.join('\n');
  const thM = scope0.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (!thM) {
    const thArrM = scope0.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i);
    if (thArrM) out.thumb = thArrM[1].trim();
  } else {
    out.thumb = thM[1].trim();
  }
  const durM = scope0.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i);
  if (durM && (durM[1] || durM[2] || durM[3])) {
    out.durationSec = (Number(durM[1]) || 0) * 3600 + (Number(durM[2]) || 0) * 60 + (Number(durM[3]) || 0);
  }
  return out;
}

// -------------------------------------------------------------
// TÜRLER / GENRE HAVUZU (Önbellek)
// -------------------------------------------------------------

interface HHGenreItem {
  term_id: number;
  name: string;
  slug: string;
  count: number;
  thumbnail?: string;
}

let cachedGenres: HHGenreItem[] | null = null;
let genresPromise: Promise<HHGenreItem[]> | null = null;

async function getAllGenres(): Promise<HHGenreItem[]> {
  if (cachedGenres) return cachedGenres;
  if (genresPromise) return genresPromise;

  genresPromise = (async () => {
    try {
      const data = await fetchHentaiHavenApi<HHGenreItem[]>('genre/all', {}, 10000);
      if (Array.isArray(data)) {
        cachedGenres = data;
        return data;
      }
      return [];
    } catch {
      return [];
    } finally {
      genresPromise = null;
    }
  })();

  return genresPromise;
}

/**
 * HentaiHaven etiket / tür arama ve otomatik tamamlama.
 * 50+ kategori türünü (Yuri, School, 3D Hentai vb.) tam sayılarıyla önerir.
 */
export async function searchHentaiHavenTags(
  query: string,
  limit: number = 12
): Promise<BooruTagSuggestion[]> {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const genres = await getAllGenres();
  const matched = genres.filter(
    (g) => g.name.toLowerCase().includes(q) || g.slug.toLowerCase().includes(q)
  );

  return matched.slice(0, limit).map((g) => ({
    name: g.name,
    category: 'general' as TagCategory,
    postCount: g.count,
  }));
}

// -------------------------------------------------------------
// API TABANLI GÖNDERİ ÇEKME (fetchHentaiHavenPosts)
// -------------------------------------------------------------

function mapApiItemToPost(item: any, source: BooruSource): BooruPost {
  const numericId = item.post_ID;
  const slug = item.post_name || String(numericId);
  const base = (source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '');
  const poster = item.post_thumbnail || '';

  return {
    id: 'hh_' + numericId,
    sourceId: source.id,
    sourceName: source.name,
    title: item.post_title || undefined,
    previewUrl: poster,
    previewVideoUrl: undefined,
    previewThumbUrl: undefined,
    previewThumbs: undefined,
    sampleUrl: poster,
    originalUrl: '',
    width: 600,
    height: 900,
    aspectRatio: 2 / 3,
    rating: 'e',
    score: 0,
    favCount: 0,
    tags: {
      artist: [],
      character: [],
      copyright: [],
      general: [],
      meta: ['video'],
    },
    allTags: [],
    sourceLink: `${base}/watch/${slug}/`,
    mediaId: String(numericId),
    fileExt: 'mp4',
    createdAt: item.post_date || new Date().toISOString(),
  };
}

/**
 * Resmi API üzerinden Hentai Haven içeriklerini listeler.
 * - Sorgu boş: `GET /hentai/all?p=N`
 * - Tür eşleşmesi: `GET /genre/{term_id}?p=N`
 * - Metin araması: `GET /search?q={query}&p=N`
 */
export async function fetchHentaiHavenPosts(
  source: BooruSource,
  page: number,
  tags: string = ''
): Promise<BooruPost[]> {
  const cleanQuery = tags
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !t.startsWith('-'))
    .join(' ');

  try {
    // 1. Sorgu boş -> Tüm liste
    if (!cleanQuery) {
      const data = await fetchHentaiHavenApi<{ hentais: any[] }>(`hentai/all?p=${page}`);
      const list = Array.isArray(data?.hentais) ? data.hentais : [];
      return list.map((item) => mapApiItemToPost(item, source));
    }

    // 2. Tür kontrolü
    const genres = await getAllGenres();
    const cleanLower = cleanQuery.toLowerCase().replace(/^tag:\s*/i, '').trim();
    const matchedGenre = genres.find(
      (g) => g.name.toLowerCase() === cleanLower || g.slug === cleanLower
    );

    if (matchedGenre) {
      const data = await fetchHentaiHavenApi<{ hentais: any[] }>(
        `genre/${matchedGenre.term_id}?p=${page}`
      );
      const list = Array.isArray(data?.hentais) ? data.hentais : [];
      return list.map((item) => mapApiItemToPost(item, source));
    }

    // 3. Genel metin araması (search?q=...)
    const pageSuffix = page > 1 ? `&p=${page}` : '';
    const data = await fetchHentaiHavenApi<any[]>(
      `search?q=${encodeURIComponent(cleanQuery)}${pageSuffix}`
    );

    const list = Array.isArray(data) ? data : [];
    return list.map((item) => mapApiItemToPost(item, source));
  } catch (apiErr: any) {
    console.warn('[HentaiHaven] API hatası, HTML yedeğine geçiliyor:', apiErr?.message || apiErr);

    // 4. Güvenlik ağı: HTML Kazıma Yedeği
    const candidates = buildHentaiHavenSearchCandidates(source.baseUrl || HENTAIHAVEN_BASE, page, cleanQuery);
    if (candidates.length === 0) return [];
    const url = candidates[0];
    const headers = {
      'User-Agent': HENTAIHAVEN_UA,
      Referer: `${(source.baseUrl || HENTAIHAVEN_BASE).replace(/\/$/, '')}/`,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    };

    const res = await proxyService.fetchWithFallback(url, { headers }, 10000);
    if (!res.ok) return [];
    const html = await res.text();
    return parseHentaiHavenListing(html, source);
  }
}

// -------------------------------------------------------------
// BÖLÜM VE DETAY ÇÖZÜMLEME
// -------------------------------------------------------------

async function fetchHentaiHtml(
  url: string,
  ms: number,
  label: string,
  signal?: AbortSignal
): Promise<string | null> {
  const headers = {
    'User-Agent': HENTAIHAVEN_UA,
    Referer: HENTAIHAVEN_BASE + '/',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml',
  };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await proxyService.fetchWithFallback(url, { headers, signal: ctrl.signal }, ms);
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn('[HentaiHaven] HTTP ' + res.status + ' (' + label + ')');
      return null;
    }
    return await res.text();
  } catch (e: any) {
    clearTimeout(timeout);
    console.warn('[HentaiHaven] ağ hatası (' + label + '): ' + (e?.message || e));
    return null;
  }
}

/**
 * HentaiHaven SEO/Spam ve toplayıcı marka etiketleri havuzu.
 * Sitenin veritabanında arama motoru sıralaması için eklenmiş 40+ gereksiz etiket elenir.
 */
export const HENTAIHAVEN_SPAM_TAGS = new Set([
  // Toplayıcı ve rakip marka adları
  'e hentai',
  'ehentai',
  'ge hentai',
  'gehentai',
  'xanimeporn',
  'anime porn',
  'animeporn',
  'hanime tv',
  'hanimetv',
  'hanime',
  'hentai stream',
  'hentaistream',
  'mp4hentai',
  'hentaidude',
  'watch hentai',
  'watchhentai',
  'hentai foundry',
  'hentaifoundry',
  'hentai haven',
  'hentaihaven',
  'nhentai',
  'hentai chan',
  'hentaichan',
  'hentaicity',
  'hentai city',
  'gelbooru',
  'danbooru',
  'xhentai',
  'ohentai',
  'miohentai',
  'hentaicore',
  'hentaifreak',
  'kisshentai',
  'hentaiworld',
  'rule 34',
  'rule34',
  'pornhub',
  'xvideos',
  'xhamster',
  'spankbang',
  'redgifs',
  // Saf gürültü / ayırt edici olmayan jenerik kelimeler
  'hentai',
  'hentai porn',
  'hentaiporn',
  'hentai anime',
  'anime hentai',
  'hentai videos',
  'hentai video',
  'hentaivideos',
  'hentaivideo',
  'free hentai',
  'freehentai',
  'hentai manga',
  'hentai vid',
  'hentaivid',
  'hentai tv',
  'hentaitv',
  'hd',
  'sexy',
]);

/**
 * Bir etiketin HentaiHaven spam/çöp etiketi olup olmadığını doğrular.
 */
export function isHentaiHavenSpamTag(tag: string | undefined): boolean {
  const norm = (tag || '').toLowerCase().trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  if (!norm || norm.length < 2) return true;
  if (HENTAIHAVEN_SPAM_TAGS.has(norm)) return true;

  // Jenerik kalıp kontrolleri
  if (/^(watch|free|best|top|download)\s+hentai$/i.test(norm)) return true;
  if (/^hentai\s+(stream|tube|city|hub|world|haven|freak|core|chan|foundry|dude|video|videos|porn)$/i.test(norm)) return true;
  if (/^(kiss|mio|mp4|e|ge|x|o|n)\s*hentai/i.test(norm)) return true;

  return false;
}

/**
 * HentaiHaven etiket listesini SEO çöplerinden arındırır ve gereksiz tekrarları normalize eder.
 * Örn:
 * - 'eHentai', 'Gelbooru', 'Pornhub', 'Hentai' vb. tamamen atılır.
 * - 'Anal Hentai' -> 'Anal', 'Yuri Porn' -> 'Yuri', 'Teacher Hentai' -> 'Teacher'.
 * - Büyük/küçük harf duyarsız tekilleştirme yapılır.
 */
export function cleanHentaiHavenTags(rawTags: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of rawTags) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (isHentaiHavenSpamTag(trimmed)) continue;

    let norm = trimmed;
    // '3D Hentai' dışındaki gereksiz ' Hentai' / 'Hentai ' eklerini sadeleştir
    if (/\bhentai\b/i.test(norm) && norm.toLowerCase() !== '3d hentai') {
      const stripped = norm.replace(/\bhentai\b/gi, '').trim().replace(/\s+/g, ' ');
      if (stripped.length >= 3) {
        norm = stripped;
      }
    }
    // ' Porn' eklerini sadeleştir (örn. 'Yuri Porn' -> 'Yuri')
    if (/\bporn\b/i.test(norm)) {
      const stripped = norm.replace(/\bporn\b/gi, '').trim().replace(/\s+/g, ' ');
      if (stripped.length >= 3) {
        norm = stripped;
      }
    }

    const key = norm.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(norm);
    }
  }

  return cleaned;
}

/**
 * Bir içeriğin ID veya slug'ından detay ve bölümlerini API ile çözer.
 */
export async function resolveHentaiHavenGalleryDetail(
  postRef: { mediaId?: string; id?: string; sourceLink?: string },
  signal?: AbortSignal
): Promise<{
  episodes: HentaiHavenEpisode[];
  tags: BooruPost['tags'];
  allTags: string[];
  views: number;
  rating?: { rating: string | number; votes: number };
  description?: string;
  title?: string;
  name?: string;
} | null> {
  let targetId: number | null = null;

  // 1. Sayısal mediaId veya id'den çıkar
  if (postRef.mediaId && /^\d+$/.test(postRef.mediaId)) {
    targetId = parseInt(postRef.mediaId, 10);
  } else if (postRef.id && /^hh_(\d+)$/i.test(postRef.id)) {
    const m = postRef.id.match(/^hh_(\d+)$/i);
    if (m) targetId = parseInt(m[1], 10);
  }

  // 2. Sayısal bulunamadıysa slug ile API aramasından bul
  if (!targetId && postRef.sourceLink) {
    const slugM = postRef.sourceLink.match(/\/watch\/([a-z0-9-]+)\//i);
    if (slugM) {
      const slug = slugM[1];
      const searchWords = slug.replace(/-/g, ' ');
      try {
        const results = await fetchHentaiHavenApi<any[]>(
          `search?q=${encodeURIComponent(searchWords)}`,
          {},
          8000,
          signal
        );
        if (Array.isArray(results)) {
          const matched = results.find((r) => r.post_name === slug || r.post_ID === Number(slug));
          if (matched?.post_ID) targetId = matched.post_ID;
        }
      } catch {}
    }
  }

  if (!targetId) return null;

  try {
    const data = await fetchHentaiHavenApi<any>(`hentai/${targetId}`, {}, 12000, signal);
    if (!data || typeof data === 'string') return null;

    const rawEpisodes = Array.isArray(data.post_episodes) ? data.post_episodes : [];
    const episodes: HentaiHavenEpisode[] = rawEpisodes.map((ep: any, idx: number) => {
      const epNumMatch = (ep.chapter_name || ep.chapter_slug || '').match(/(\d+)/);
      const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : idx + 1;
      const streamUrl = ep.chapter_content || '';
      const previewUrl = ep.preview || '';
      const thumb = ep.chapter_thumbnail || ep.post_thumbnail || '';

      return {
        ep: epNum,
        url: streamUrl || `/watch/${data.post_name}/${ep.chapter_slug}/`,
        streamUrl,
        previewUrl,
        thumbnail: thumb,
        name: ep.chapter_name || `Episode ${epNum}`,
        chapterId: ep.chapter_id,
      };
    });

    // En yeni bölüm ilk sırada olsun
    episodes.sort((a, b) => b.ep - a.ep);

    const rawGeneral: string[] = [];
    if (Array.isArray(data.post_genres)) {
      data.post_genres.forEach((g: any) => {
        if (g.name) rawGeneral.push(g.name);
      });
    }
    if (Array.isArray(data.post_tags)) {
      data.post_tags.forEach((t: any) => {
        if (t.name) rawGeneral.push(t.name);
      });
    }
    const generalTags = cleanHentaiHavenTags(rawGeneral);

    const artistTags: string[] = [];
    if (Array.isArray(data.post_authors)) {
      data.post_authors.forEach((a: any) => {
        if (a.name && !isHentaiHavenSpamTag(a.name)) artistTags.push(a.name.trim());
      });
    }

    const tags: BooruPost['tags'] = {
      artist: artistTags,
      character: [],
      copyright: [],
      general: generalTags,
      meta: ['video'],
    };
    const allTags = [...artistTags, ...generalTags];

    return {
      episodes,
      tags,
      allTags,
      views: Number(data.post_views) || 0,
      rating: data.post_rating,
      description: data.post_content || '',
      title: data.post_title,
      name: data.post_name,
    };
  } catch (err: any) {
    console.warn('[HentaiHaven] API detay çözme hatası:', err?.message || err);
    return null;
  }
}

/**
 * Seri sayfasindaki bolum listesi (en yeni ilk). Izleyicideki EP secici icin.
 */
export async function listHentaiHavenEpisodes(
  post: { sourceLink?: string; id?: string; mediaId?: string },
  signal?: AbortSignal
): Promise<HentaiHavenEpisode[]> {
  // 1. Önce doğrudan resmi API
  const apiDetail = await resolveHentaiHavenGalleryDetail(post, signal);
  if (apiDetail && apiDetail.episodes.length > 0) {
    return apiDetail.episodes;
  }

  // 2. HTML Kazıma Yedeği
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return [];
  const html = await fetchHentaiHtml(post.sourceLink, 10000, 'seri', signal);
  if (!html || isChallengeHtml(html)) return [];
  return parseHentaiHavenEpisodes(html, post.sourceLink);
}

/**
 * Tek bolum sayfasindan veya dogrudan URL'den oynatilabilir dosya.
 */
export async function resolveHentaiHavenEpisodeUrl(
  episodeUrl: string,
  signal?: AbortSignal
): Promise<HentaiHavenFiles | null> {
  if (!episodeUrl) return null;

  // Doğrudan HLS veya MP4 URL'si verilmişse ağ çağrısı yapmadan döndür
  if (/\.m3u8/i.test(episodeUrl.split('?')[0])) {
    return { hls: episodeUrl, mp4: '', thumb: '' };
  }
  if (/\.mp4/i.test(episodeUrl.split('?')[0])) {
    return { hls: '', mp4: episodeUrl, thumb: '' };
  }

  if (!/^https?:\/\//i.test(episodeUrl)) return null;

  // HTML Kazıma Yedeği
  const html = await fetchHentaiHtml(episodeUrl, 10000, 'bölüm', signal);
  if (!html || isChallengeHtml(html)) return null;
  const files = parseHentaiHavenEpisodeDetail(html);
  if (!files.hls && !files.mp4) return null;
  return files;
}

/**
 * Seri -> en yeni veya tercih edilen bölüm -> HLS akışını çözer.
 */
export async function resolveHentaiHavenEpisodeUrls(
  post: { sourceLink?: string; id?: string; mediaId?: string; previewUrl?: string },
  signal?: AbortSignal,
  preferredEp?: number | null
): Promise<HentaiHavenFiles | null> {
  // 1. Önce resmi API yolu
  const detail = await resolveHentaiHavenGalleryDetail(post, signal);
  if (detail && detail.episodes.length > 0) {
    const episodes = detail.episodes;
    const targetEp =
      preferredEp != null
        ? episodes.find((e) => e.ep === preferredEp) || episodes[0]
        : episodes[0];

    const playableHls = targetEp.streamUrl || (targetEp.url.includes('.m3u8') ? targetEp.url : '');
    const playableMp4 = targetEp.previewUrl || (targetEp.url.includes('.mp4') ? targetEp.url : '');

    if (playableHls || playableMp4) {
      return {
        hls: playableHls,
        mp4: playableMp4,
        thumb: targetEp.thumbnail || post.previewUrl || '',
        episodes,
        tags: detail.tags,
        allTags: detail.allTags,
        views: detail.views,
        rating: detail.rating,
        description: detail.description,
      };
    }
  }

  // 2. HTML Kazıma Yedeği
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;

  const seriesHtml = await fetchHentaiHtml(post.sourceLink, 10000, 'seri', signal);
  if (!seriesHtml) return null;
  if (isChallengeHtml(seriesHtml)) {
    console.warn('[HentaiHaven] doğrulama duvarı (seri)');
    return null;
  }
  const episodes = parseHentaiHavenEpisodes(seriesHtml, post.sourceLink);
  if (episodes.length === 0) {
    console.warn('[HentaiHaven] bölüm bulunamadı');
    return null;
  }
  const targetEp =
    preferredEp != null
      ? episodes.find((e) => e.ep === preferredEp) || episodes[0]
      : episodes[0];
  const baseM = post.sourceLink.match(/^https?:\/\/[^/]+/i);
  const epUrl = (baseM ? baseM[0] : HENTAIHAVEN_BASE) + targetEp.url;
  const epHtml = await fetchHentaiHtml(epUrl, 10000, 'bölüm', signal);
  if (!epHtml) return null;
  if (isChallengeHtml(epHtml)) {
    console.warn('[HentaiHaven] doğrulama duvarı (bölüm)');
    return null;
  }
  const files = parseHentaiHavenEpisodeDetail(epHtml);
  if (!files.hls && !files.mp4) {
    console.warn('[HentaiHaven] HLS bulunamadı');
    return null;
  }
  files.episodes = episodes;
  return files;
}
