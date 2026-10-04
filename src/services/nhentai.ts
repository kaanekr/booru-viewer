import type { BooruPost, BooruSource, BooruTagGroups, BooruTagSuggestion, TagCategory } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * nhentai entegrasyonu - saf yardimcilar.
 * YALNIZCA resmi v2 API (https://nhentai.net/api/v2/docs, openapi.json projededir).
 * Ayna (nhentai.xxx) ve HTML kazıma tamamen kaldırıldı.
 * - Liste/detay: /api/v2/galleries, /api/v2/search, /api/v2/galleries/{id}
 * - Etiket: POST /api/v2/tags/search
 * - Görsel CDN: t1/i1.nhentai.net (API'nin verdiği path'ler kullanılır)
 * - Skor = num_favorites (puan favori sayısına birebir eşlenir)
 */

export const NHENTAI_BASE = 'https://nhentai.net';
export const NHENTAI_IMAGE_BASE = 'https://i3.nhentai.net';
export const NHENTAI_THUMB_BASE = 'https://t3.nhentai.net';

/**
 * Resmi v2 API (https://nhentai.net/api/v2/docs).
 * Puan/skor doğrudan `num_favorites` değerine eşlenir.
 *
 * CDN NOTU (cihazda doğrulandı): t1/i1 hostları bazı ağlarda engelli/çözümsüz
 * (Safari'de t1 açılmıyor, t2/t3 açılıyor). Bu yüzden varsayılan kapak t3,
 * yedek kapak t2, tam sayfalar i3 üzerinden alınır; tek host kesintisinde
 * kartlar yine de görsel gösterir (PostCard thumb->cover fallback'i).
 */
export const NHENTAI_API_BASE = 'https://nhentai.net/api/v2';
export const NHENTAI_API_THUMB_BASE = 'https://t3.nhentai.net';
export const NHENTAI_API_THUMB_FALLBACK_BASE = 'https://t2.nhentai.net';
export const NHENTAI_API_IMAGE_BASE = 'https://i3.nhentai.net';

/**
 * v2 API istekleri Safari'yi birebir taklit eder (cihazda doğrulandı: aynı URL
 * Safari'de açılırken uygulamada takılıyordu — bot koruması istek parmak izini
 * bayraklayıp gövdeyi akıtmıyordu).
 * - Tam Safari formu (`Version/18.x ... Safari/604.1` token'larıyla): tokensiz
 *   WKWebView-kokulu formdan ayırt edilir.
 * - Referer YOK (doğrudan gezinme gibi).
 * - Accept-Encoding müdahalesi YOK (RN/NSURLSession varsayılanı + şeffaf çözüm;
 *   elle header gövde akışını bozabiliyordu).
 */
export const NHENTAI_API_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1';

/** Tüm v2 API JSON çağrılarında kullanılan tek header seti. */
export function nhentaiApiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': NHENTAI_API_UA,
    Accept: 'application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(extra || {}),
  };
}

const EXT_MAP: Record<string, string> = {
  j: 'jpg',
  p: 'png',
  w: 'webp',
  g: 'gif',
};

export function extFromType(t: string | undefined): string {
  if (!t) return 'jpg';
  const clean = t.toLowerCase().trim();
  return EXT_MAP[clean] || (clean.length <= 4 ? clean : 'jpg');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export interface NHentaiPageInfo {
  page: number;
  url: string;
  width?: number;
  height?: number;
}

export interface NHentaiGalleryDetail {
  id: string;
  mediaId: string;
  title: string;
  pageCount: number;
  pages: string[];
  coverUrl: string;
  tags: BooruTagGroups;
  allTags: string[];
}

/**
 * Filtre sıralaması -> v2 API `sort` değeri.
 * v2 zaman aralıklı popülerliği de destekler (canlı doğrulandı):
 * popular / popular-today / popular-week / popular-month / date
 */
export function nhentaiApiSort(sortBy?: string, timeRange?: string): string {
  if (sortBy === 'score') {
    if (timeRange === '1d') return 'popular-today';
    if (timeRange === '1w') return 'popular-week';
    if (timeRange === '1m') return 'popular-month';
    return 'popular';
  }
  return 'date';
}

/**
 * v2 API aday URL'leri (resmi dokümantasyona göre: https://nhentai.net/api/v2/docs).
 * - En yeniler (filtresiz): GET /api/v2/galleries?page={p}&per_page=25
 * - Günün popülerleri (kelimesiz): GET /api/v2/galleries/popular (yalnız 1. sayfa,
 *   94ms — `query=*&sort=popular-today` ile aynı havuz ama katbekat hızlı)
 * - Popüler akış (kelimesiz): GET /api/v2/search?query=*&sort={sort}&page={p}
 *   (dokümana göre query=* tüm arşivi döner; 650.000+ galeri sayfalanabilir).
 *   NOT: `*` + zaman aralıklı sıralama sunucuda saniyeler sürer (popular-month
 *   ~4s ölçüldü); istemci timeout'u buna göre cömert tutulur, retry YAPILMAZ
 *   (her retry rate-limit bütçesini yakar: search anonim 10 req/dk).
 * - Arama: GET /api/v2/search?query={q}&sort={sort}&page={p}
 *   (doküman: keywords, "exact phrase", -negation, artist:x, tag:x, favorites:>=X).
 */
export function buildNHentaiApiCandidates(
  page: number,
  keyword: string,
  sort: string = 'date',
  minScore?: number
): string[] {
  const p = Math.max(1, page);
  let q = (keyword || '').trim();

  // Sunucu tarafı favori (skor) filtresi: API dokümantasyonu `favorites:>=100` destekler
  if (minScore && minScore > 0 && !q.includes('favorites:')) {
    q = q ? `${q} favorites:>=${minScore}` : `favorites:>=${minScore}`;
  }

  if (!q) {
    if (sort === 'popular-today') {
      return p <= 1 ? [`${NHENTAI_API_BASE}/galleries/popular`] : [];
    }
    if (sort !== 'date') {
      // Kelimesiz popüler akış: query=* ile tüm arşiv popülerliğe göre sayfalanır (25/sayfa)
      return [`${NHENTAI_API_BASE}/search?query=*&sort=${sort}&page=${p}`];
    }
    return [`${NHENTAI_API_BASE}/galleries?page=${p}&per_page=25`];
  }

  return [
    `${NHENTAI_API_BASE}/search?query=${encodeURIComponent(q)}&sort=${sort}&page=${p}`,
  ];
}

/**
 * v2 liste ayrıştırıcı. `num_favorites` -> score/favCount (puan = favori sayısı).
 * Görseller t1/i1 CDN'inden gelir; liste yalnız tag_id verir (adlar detayda çözülür).
 */
export function parseNHentaiV2Listing(jsonText: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!jsonText) return posts;
  try {
    const data = JSON.parse(jsonText);
    const items = Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [];
    const base = (source.baseUrl || NHENTAI_BASE).replace(/\/$/, '');
    for (const item of items) {
      if (!item || !item.id || !item.media_id) continue;
      if (item.blacklisted) continue;
      const id = String(item.id);
      const mediaId = String(item.media_id);
      const title = decodeEntities(
        String(item.english_title || item.japanese_title || ('Gallery #' + id))
      ).trim();
      const thumbPath = String(item.thumbnail || '');
      const thumb = thumbPath.startsWith('http')
        ? thumbPath
        : `${NHENTAI_API_THUMB_BASE}/${thumbPath.replace(/^\//, '')}`;
      // Uzantı CDN'de korunur (thumb.webp vs thumb.jpg) — 1. sayfa URL'si
      // sabit .webp olursa jpg galerilerde 404 veriyor (canlı doğrulandı).
      const extMatch = thumb.match(/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i);
      const ext = (extMatch ? extMatch[1].toLowerCase() : 'webp').replace('jpeg', 'jpg');
      // Yedek kapak farklı host'tan (t2): birincil CDN hostu kesilirse
      // PostCard'in thumb->cover fallback'i yine de görsel getirir.
      const cover = thumb
        .replace(/\/thumb\./i, '/cover.')
        .replace(NHENTAI_API_THUMB_BASE, NHENTAI_API_THUMB_FALLBACK_BASE);
      const width = Number(item.thumbnail_width) || 250;
      const height = Number(item.thumbnail_height) || 350;
      const aspectRatio = width > 0 && height > 0 ? width / height : 250 / 350;
      const favorites = Number(item.num_favorites) || 0;
      const pageCount = Number(item.num_pages) || 0;

      posts.push({
        id: 'nh_' + id,
        sourceId: source.id,
        sourceName: source.name,
        title: title || undefined,
        previewUrl: thumb,
        sampleUrl: cover,
        originalUrl: `${NHENTAI_API_IMAGE_BASE}/galleries/${mediaId}/1.${ext}`,
        width,
        height,
        aspectRatio,
        rating: 'e',
        score: favorites,
        favCount: favorites,
        tags: { artist: [], character: [], copyright: [], general: [], meta: ['manga'] },
        allTags: [],
        sourceLink: `https://nhentai.net/g/${id}/`,
        fileExt: ext,
        createdAt: new Date().toISOString(),
        pageCount: pageCount > 0 ? pageCount : undefined,
        mediaId,
      });
    }
  } catch (e) {
    console.warn('[nhentai] v2 JSON parse hatası:', e);
  }
  return posts;
}

/**
 * Galeri detay JSON'undan (v2: /api/v2/galleries/{id}) manganın TÜM sayfa
 * URL'lerini çıkarır. v1 JSON (`images.pages`) geriye uyumlu olarak desteklenir.
 */
export function parseNHentaiGalleryPages(
  raw: string,
  galleryId?: string
): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return [];

  try {
    const data = JSON.parse(trimmed);
    // v2: pages: [{number, path, width, height}]
    if (Array.isArray(data?.pages)) {
      const v2Pages = data.pages
        .map((p: any) => {
          const path = typeof p === 'string' ? p : p?.path;
          if (!path) return '';
          const n = typeof p === 'object' && p?.number ? p.number : 0;
          const abs = String(path).startsWith('http')
            ? String(path)
            : `${NHENTAI_API_IMAGE_BASE}/${String(path).replace(/^\//, '')}`;
          return n ? `${n}|${abs}` : '';
        })
        .filter(Boolean)
        .sort((a: string, b: string) => Number(a.split('|')[0]) - Number(b.split('|')[0]))
        .map((s: string) => s.slice(s.indexOf('|') + 1));
      if (v2Pages.length > 0) return v2Pages;
    }
    // v1
    const mediaId = data?.media_id;
    const pages = data?.images?.pages;
    if (mediaId && Array.isArray(pages)) {
      return pages.map((p, idx) => {
        const ext = extFromType(p?.t);
        return `${NHENTAI_IMAGE_BASE}/galleries/${mediaId}/${idx + 1}.${ext}`;
      });
    }
  } catch {}

  return [];
}

export interface NHentaiResolvedGallery {
  pages: string[];
  tags: BooruTagGroups;
  allTags: string[];
  pageCount: number;
  /** v2 detaydan gelen favori sayısı (skor); yoksa undefined */
  numFavorites?: number;
}

/** v2 detay JSON'undan etiket gruplarını ayıklar (adlar + tipler gelir). */
export function parseNHentaiV2DetailTags(jsonText: string): { tags: BooruTagGroups; allTags: string[]; numFavorites: number } {
  const tags: BooruTagGroups = { artist: [], character: [], copyright: [], general: [], meta: ['manga'] };
  const allTags: string[] = [];
  let numFavorites = 0;
  if (!jsonText) return { tags, allTags, numFavorites };
  try {
    const data = JSON.parse(jsonText);
    numFavorites = Number(data?.num_favorites) || 0;
    const list = Array.isArray(data?.tags) ? data.tags : [];
    const seen = new Set<string>();
    for (const t of list) {
      const name = decodeEntities(String(t?.name || '')).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      allTags.push(name);
      const type = String(t?.type || '').toLowerCase();
      if (type === 'artist' || type === 'group') tags.artist.push(name);
      else if (type === 'character') tags.character.push(name);
      else if (type === 'parody') tags.copyright.push(name);
      else if (type === 'tag') tags.general.push(name);
      else tags.meta.push(name);
    }
  } catch {}
  return { tags, allTags, numFavorites };
}

/**
 * nhentai galeri detayını (sayfalar + etiketler + favori sayısı) doğrudan
 * resmi v2 API'den (https://nhentai.net/api/v2/docs) çözer.
 */
export async function resolveNHentaiGalleryDetail(
  post: { id?: string; sourceLink?: string; mediaId?: string; pageCount?: number; fileExt?: string },
  signal?: AbortSignal
): Promise<NHentaiResolvedGallery> {
  const empty: NHentaiResolvedGallery = {
    pages: [],
    tags: { artist: [], character: [], copyright: [], general: [], meta: ['manga'] },
    allTags: [],
    pageCount: post.pageCount || 0,
  };

  const rawId = (post.id || '').replace(/^nh_/, '');
  if (!rawId) return empty;

  const headers = nhentaiApiHeaders();

  const fetchWithTimeout = async (url: string, ms = 9000): Promise<string | null> => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), ms);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await proxyService.fetchWithFallback(url, { headers, signal: ctrl.signal }, ms);
      clearTimeout(timeout);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      clearTimeout(timeout);
      return null;
    }
  };

  // 1. Resmi v2 API detay: GET /api/v2/galleries/{id}
  const v2Text = await fetchWithTimeout(`${NHENTAI_API_BASE}/galleries/${rawId}`, 12000);
  if (v2Text) {
    const pages = parseNHentaiGalleryPages(v2Text, rawId);
    const detail = parseNHentaiV2DetailTags(v2Text);
    if (pages.length > 0) {
      return {
        pages,
        tags: detail.tags,
        allTags: detail.allTags,
        pageCount: pages.length,
        numFavorites: detail.numFavorites || undefined,
      };
    }
  }

  // 2. Ağ hatası durumunda sentetik CDN güvenlik ağı (i1.nhentai.net)
  if (post.mediaId && post.pageCount && post.pageCount > 0) {
    const ext = (post.fileExt || 'webp').toLowerCase().replace('jpeg', 'jpg');
    const synthetic: string[] = [];
    for (let p = 1; p <= post.pageCount; p++) {
      synthetic.push(`${NHENTAI_API_IMAGE_BASE}/galleries/${post.mediaId}/${p}.${ext}`);
    }
    return { ...empty, pages: synthetic, pageCount: synthetic.length };
  }

  return empty;
}

/**
 * nhentai manga sayfalarını çözer (MangaReaderView için geriye uyumlu).
 */
export async function resolveNHentaiPages(
  post: { id?: string; sourceLink?: string; mediaId?: string; pageCount?: number },
  signal?: AbortSignal
): Promise<string[]> {
  const detail = await resolveNHentaiGalleryDetail(post, signal);
  return detail.pages;
}

/**
 * Popüler nhentai etiketleri ve terimleri (arama çubuğunda anlık otomatik tamamlama).
 */
const COMMON_NHENTAI_TAGS: Array<{ name: string; category: TagCategory; postCount: number }> = [
  // Parodies (Copyright)
  { name: 'genshin impact', category: 'copyright', postCount: 4200 },
  { name: 'blue archive', category: 'copyright', postCount: 3800 },
  { name: 'fate grand order', category: 'copyright', postCount: 8900 },
  { name: 'naruto', category: 'copyright', postCount: 2900 },
  { name: 'one piece', category: 'copyright', postCount: 2100 },
  { name: 'pokemon', category: 'copyright', postCount: 2600 },
  { name: 'honkai star rail', category: 'copyright', postCount: 1900 },
  { name: 'hololive', category: 'copyright', postCount: 2400 },
  { name: 'neon genesis evangelion', category: 'copyright', postCount: 3100 },
  { name: 'dragon ball z', category: 'copyright', postCount: 1200 },
  { name: 'bleach', category: 'copyright', postCount: 1400 },
  { name: 'idolmaster', category: 'copyright', postCount: 7800 },
  { name: 'kantai collection', category: 'copyright', postCount: 8500 },
  { name: 'touhou project', category: 'copyright', postCount: 14000 },
  { name: 'original', category: 'copyright', postCount: 35000 },

  // Characters
  { name: 'asuka langley soryu', category: 'character', postCount: 1400 },
  { name: 'raiden shogun', category: 'character', postCount: 850 },
  { name: 'tifa lockhart', category: 'character', postCount: 920 },
  { name: 'ganyu', category: 'character', postCount: 780 },
  { name: 'yelan', category: 'character', postCount: 610 },
  { name: 'hinata hyuga', category: 'character', postCount: 890 },
  { name: 'tsunade', category: 'character', postCount: 760 },
  { name: 'remi', category: 'character', postCount: 430 },
  { name: 'artoria pendragon', category: 'character', postCount: 1100 },

  // General Tags
  { name: 'sole female', category: 'general', postCount: 115000 },
  { name: 'sole male', category: 'general', postCount: 98000 },
  { name: 'big breasts', category: 'general', postCount: 145000 },
  { name: 'nakadashi', category: 'general', postCount: 68000 },
  { name: 'blowjob', category: 'general', postCount: 56000 },
  { name: 'schoolgirl uniform', category: 'general', postCount: 62000 },
  { name: 'stockings', category: 'general', postCount: 72000 },
  { name: 'anal', category: 'general', postCount: 74000 },
  { name: 'milf', category: 'general', postCount: 39000 },
  { name: 'glasses', category: 'general', postCount: 54000 },
  { name: 'netorare', category: 'general', postCount: 28000 },
  { name: 'bondage', category: 'general', postCount: 37000 },
  { name: 'paizuri', category: 'general', postCount: 29000 },
  { name: 'femdom', category: 'general', postCount: 24000 },
  { name: 'maid', category: 'general', postCount: 14000 },
  { name: 'swimsuit', category: 'general', postCount: 22000 },
  { name: 'x-ray', category: 'general', postCount: 27000 },
  { name: 'uncensored', category: 'general', postCount: 12000 },
  { name: 'yuri', category: 'general', postCount: 26000 },
  { name: 'yaoi', category: 'general', postCount: 19000 },
  { name: 'ahegao', category: 'general', postCount: 34000 },
  { name: 'cheating', category: 'general', postCount: 18000 },
  { name: 'dilf', category: 'general', postCount: 12000 },
  { name: 'cosplay', category: 'general', postCount: 15000 },

  // Meta
  { name: 'english', category: 'meta', postCount: 108000 },
  { name: 'translated', category: 'meta', postCount: 112000 },
  { name: 'japanese', category: 'meta', postCount: 250000 },
  { name: 'manga', category: 'meta', postCount: 350000 },
  { name: 'color', category: 'meta', postCount: 16000 },
];

/** v2 etiket tipi -> uygulama kategorisi */
function nhentaiTagCategory(type: string): TagCategory {
  switch (type.toLowerCase()) {
    case 'artist':
    case 'group':
      return 'artist';
    case 'character':
      return 'character';
    case 'parody':
      return 'copyright';
    case 'language':
    case 'category':
      return 'meta';
    default:
      return 'general';
  }
}

/**
 * v2 etiket araması (resmi POST /api/v2/tags/search endpoint'i).
 * Tek çağrıda tüm türleri (parody, character, artist, group, tag) gerçek gönderi
 * sayılarıyla döner.
 */
export async function searchNHentaiApiTags(
  query: string,
  limit: number = 12
): Promise<BooruTagSuggestion[]> {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    const url = `${NHENTAI_API_BASE}/tags/search`;
    const res = await proxyService.fetchWithFallback(
      url,
      {
        method: 'POST',
        headers: nhentaiApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: q, limit: Math.min(50, Math.max(5, limit)) }),
      },
      5000
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((t: any) => {
        const name = decodeEntities(String(t?.name || '')).trim();
        if (!name) return null;
        return {
          name,
          category: nhentaiTagCategory(String(t?.type || 'tag')),
          postCount: Number(t?.count) || 0,
        };
      })
      .filter(Boolean) as BooruTagSuggestion[];
  } catch {
    return [];
  }
}

/**
 * nhentai etiket araması / otomatik tamamlama.
 * Sıra: yerel havuz (anında) -> resmi v2 POST /api/v2/tags/search.
 */
export async function searchNHentaiTags(
  query: string,
  limit: number = 12
): Promise<BooruTagSuggestion[]> {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];

  const results: BooruTagSuggestion[] = [];
  const seen = new Set<string>();

  // 1. Yerel hızlı eşleşme (anında yanıt)
  for (const tag of COMMON_NHENTAI_TAGS) {
    if (tag.name.toLowerCase().includes(q)) {
      results.push(tag);
      seen.add(tag.name.toLowerCase());
      if (results.length >= limit) break;
    }
  }

  // 2. Resmi v2 API etiket araması (POST /api/v2/tags/search)
  if (results.length < limit) {
    const apiResults = await searchNHentaiApiTags(q, limit);
    for (const r of apiResults) {
      if (seen.has(r.name.toLowerCase())) continue;
      seen.add(r.name.toLowerCase());
      results.push(r);
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}
