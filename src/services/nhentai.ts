import type { BooruPost, BooruSource, BooruTagGroups, BooruTagSuggestion, TagCategory } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * nhentai entegrasyonu - saf yardimcilar.
 * nhentai.xxx (Cloudflare bloksuz taze ayna) ve nhentai.net kaynaklarini destekler.
 * - Gorsel CDN: i5.nhentaimg.com (xxx) ve i.nhentai.net (net).
 * - Thumbnail: thumb.jpg / 1t.jpg -> Full: 1.webp / 1.jpg.
 */

export const NHENTAI_BASE = 'https://nhentai.net';
export const NHENTAI_IMAGE_BASE = 'https://i1.nhentai.net';
export const NHENTAI_THUMB_BASE = 'https://t1.nhentai.net';

/**
 * Resmi v2 API (https://nhentai.net/api/v2/docs).
 * Tamamen resmi REST JSON API üzerinden çalışır; ayna veya HTML kazıma kullanılmaz.
 * Puan/skor doğrudan `num_favorites` değerine eşlenir.
 */
export const NHENTAI_API_BASE = 'https://nhentai.net/api/v2';
export const NHENTAI_API_THUMB_BASE = 'https://t1.nhentai.net';
export const NHENTAI_API_IMAGE_BASE = 'https://i1.nhentai.net';

export const NHENTAI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
 * Arama ve Keşfet URL adayları (nhentai.xxx aynası).
 * Not: Eski v1 API endpoint'leri (/api/galleries/all) 404/403 döndürdüğü için
 * kaldırıldı; sadece çalışan ayna HTML sayfaları kullanılır (hızlı ve takılmasız).
 */
export function buildNHentaiSearchCandidates(
  baseUrl: string,
  page: number,
  keyword: string,
  sort?: string
): string[] {
  const base = (baseUrl || NHENTAI_BASE).replace(/\/$/, '');
  const p = Math.max(1, page);
  const q = (keyword || '').trim();
  const wantPopular = sort === 'popular';
  if (!q) {
    if (wantPopular) {
      return [`${base}/search/?key=%20&page=${p}&sort=popular`];
    }
    return [p <= 1 ? `${base}/` : `${base}/?page=${p}`];
  }
  const encoded = encodeURIComponent(q);
  const sortSuffix = wantPopular ? '&sort=popular' : '';
  return [
    `${base}/search/?key=${encoded}&page=${p}${sortSuffix}`,
    `${base}/search/?q=${encoded}&page=${p}${sortSuffix}`,
  ];
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
 * - Popüler akış (kelimesiz): GET /api/v2/search?query=*&sort={sort}&page={p}
 *   (dokümana göre query=* tüm arşivi döner; 650.000+ galeri sayfalanabilir).
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
      const cover = thumb.replace(/\/thumb\./i, '/cover.');
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
        // Dikkat: nhentai.net ve ayna (nhentai.xxx) FARKLI galeri id uzayına sahip
        // (canlı doğrulandı: net 685915 "Furina Hu Tao", ayna 685915 "Houkago
        // Dorei Club"). Bu yüzden v2 kaydının detayı daima net'ten çözülür;
        // detay çözümü kaynağı sourceLink host'una bakar.
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
 * JSON API cevabından galerileri ayrıştırır (varsa).
 */
export function parseNHentaiJsonListing(
  jsonText: string,
  source: BooruSource
): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!jsonText) return posts;
  try {
    const data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
    const items = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
    const base = (source.baseUrl || NHENTAI_BASE).replace(/\/$/, '');

    for (const item of items) {
      if (!item || !item.id || !item.media_id) continue;
      const id = String(item.id);
      const mediaId = String(item.media_id);
      const pageCount = Number(item.num_pages) || (Array.isArray(item.images?.pages) ? item.images.pages.length : 0);
      const titleObj = item.title || {};
      const title = decodeEntities(titleObj.pretty || titleObj.english || titleObj.japanese || ('Gallery #' + id)).trim();

      const coverExt = extFromType(item.images?.cover?.t);
      const thumbExt = extFromType(item.images?.thumbnail?.t);
      const previewUrl = `${NHENTAI_THUMB_BASE}/galleries/${mediaId}/thumb.${thumbExt}`;
      const coverUrl = `${NHENTAI_THUMB_BASE}/galleries/${mediaId}/cover.${coverExt}`;

      const coverW = Number(item.images?.cover?.w) || 350;
      const coverH = Number(item.images?.cover?.h) || 500;
      const aspectRatio = coverW > 0 && coverH > 0 ? coverW / coverH : 2 / 3;

      // Tag gruplama
      const tagGroups: BooruTagGroups = {
        artist: [],
        character: [],
        copyright: [],
        general: [],
        meta: ['manga'],
      };
      const allTags: string[] = [];

      if (Array.isArray(item.tags)) {
        for (const t of item.tags) {
          if (!t || !t.name) continue;
          const name = String(t.name).trim();
          const type = String(t.type).toLowerCase();
          allTags.push(name);
          if (type === 'artist') tagGroups.artist.push(name);
          else if (type === 'character') tagGroups.character.push(name);
          else if (type === 'parody') tagGroups.copyright.push(name);
          else if (type === 'tag') tagGroups.general.push(name);
          else if (type === 'language' || type === 'category') tagGroups.meta.push(name);
        }
      }

      posts.push({
        id: 'nh_' + id,
        sourceId: source.id,
        sourceName: source.name,
        title: title || undefined,
        previewUrl,
        sampleUrl: coverUrl,
        originalUrl: `${NHENTAI_IMAGE_BASE}/galleries/${mediaId}/1.${coverExt}`,
        width: coverW,
        height: coverH,
        aspectRatio,
        rating: 'e',
        score: Number(item.num_favorites) || 0,
        favCount: Number(item.num_favorites) || 0,
        tags: tagGroups,
        allTags,
        sourceLink: `${base}/g/${id}/`,
        fileExt: coverExt,
        createdAt: item.upload_date ? new Date(item.upload_date * 1000).toISOString() : new Date().toISOString(),
        pageCount: pageCount > 0 ? pageCount : undefined,
        mediaId,
      });
    }
  } catch (e) {
    console.warn('[nhentai] JSON parse hatası:', e);
  }
  return posts;
}

/**
 * HTML listesinden galerileri ayrıştırır (nhentai.xxx ve nhentai.net uyumlu).
 */
export function parseNHentaiHtmlListing(
  html: string,
  source: BooruSource
): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!html) return posts;
  const base = (source.baseUrl || NHENTAI_BASE).replace(/\/$/, '');
  const seen = new Set<string>();

  // Split by gallery_item (xxx) or gallery (net)
  const chunks = html.split(/<div class="gallery(?:_item)?"/i);
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];

    const idM = c.match(/href="\/g\/(\d+)\/"/);
    if (!idM) continue;
    const id = idM[1];
    if (seen.has(id)) continue;
    seen.add(id);

    // data-src öncelikli (lazy-load), src yedek (SVG hariç)
    const dataSrcM = c.match(/data-src="([^"]+)"/i);
    const srcM = c.match(/src="([^"]+)"/i);
    let rawImg = (dataSrcM ? dataSrcM[1] : (srcM && !srcM[1].startsWith('data:') ? srcM[1] : ''))?.trim() || '';
    if (!rawImg) continue;
    if (rawImg.startsWith('//')) rawImg = 'https:' + rawImg;

    // media_id / folder path çıkar:
    // https://i5.nhentaimg.com/018/zd5ew9kgoa/thumb.jpg -> 018/zd5ew9kgoa
    // https://t.nhentai.net/galleries/1556093/thumb.jpg -> 1556093
    const mediaIdM =
      rawImg.match(/\/galleries\/(\d+)\//) ||
      rawImg.match(/\/(?:018|galleries)\/([a-z0-9_-]+)\//i);
    const mediaId = mediaIdM ? mediaIdM[1] : '';

    const titleM =
      c.match(/title="([^"]+)"/i) ||
      c.match(/<div class="caption">([\s\S]*?)<\/div>/i);
    const title = titleM
      ? decodeEntities(titleM[1]).replace(/<[^>]+>/g, '').trim()
      : `Gallery #${id}`;

    const extM = rawImg.match(/\.(jpg|png|webp|gif)(\?|$)/i);
    const ext = extM ? extM[1].toLowerCase() : 'jpg';

    // Kapak resmi
    const coverUrl = rawImg.replace(/\/thumb\.(jpg|png|webp|gif)/i, '/cover.$1');

    posts.push({
      id: 'nh_' + id,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: rawImg,
      sampleUrl: coverUrl,
      originalUrl: coverUrl,
      width: 350,
      height: 500,
      aspectRatio: 2 / 3,
      rating: 'e',
      score: 0,
      favCount: 0,
      tags: {
        artist: [],
        character: [],
        copyright: [],
        general: [],
        meta: ['manga'],
      },
      allTags: [],
      sourceLink: `${base}/g/${id}/`,
      fileExt: ext,
      createdAt: new Date().toISOString(),
      mediaId: mediaId || undefined,
    });
  }

  return posts;
}

/**
 * Hem JSON hem HTML listesini tek fonksiyonla ayrıştırır.
 */
export function parseNHentaiListing(
  raw: string,
  source: BooruSource
): BooruPost[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const jsonPosts = parseNHentaiJsonListing(trimmed, source);
    if (jsonPosts.length > 0) return jsonPosts;
  }
  return parseNHentaiHtmlListing(raw, source);
}

/**
 * Galeri detay sayfasından (HTML veya JSON) manganın TÜM sayfa URL'lerini çıkarır.
 */
export function parseNHentaiGalleryPages(
  raw: string,
  galleryId?: string
): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();

  // 1) JSON yanıtı: v1 (/api/gallery/{id}) ve v2 (/api/v2/galleries/{id})
  if (trimmed.startsWith('{')) {
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
  }

  // 2) HTML yanıtı:
  // A) nhentaimg.com (nhentai.xxx aynası):
  // nhentai.xxx sitede yalnız ilk 10 küçük kareyi HTML'e yazar, ama GERÇEK
  // toplam sayfa sayısı <span class="tag_name pages">50</span> veya id="load_pages" içinde yer alır.
  // Prefix ve toplam sayfa sayısı varsa tüm sayfaları (1..N) doğrudan üretiriz.
  const prefixM = raw.match(/https?:\/\/[^"'\s>]*nhentaimg\.com\/018\/[a-z0-9_-]+\//i);
  const totalPagesM =
    raw.match(/<span class="tag_name pages">(\d+)<\/span>/i) ||
    raw.match(/id="load_pages"\s+value="(\d+)"/i) ||
    raw.match(/name="load_pages"[^>]+value="(\d+)"/i);

  if (prefixM && totalPagesM) {
    const total = parseInt(totalPagesM[1], 10);
    if (total > 0 && total <= 500) {
      const prefix = prefixM[0];
      const allPages: string[] = [];
      for (let p = 1; p <= total; p++) {
        allPages.push(`${prefix}${p}.webp`);
      }
      return allPages;
    }
  }

  // Yedek regex: HTML'deki mevcut küçük kareleri topla
  const xxxRe = /(https?:\/\/[^"'\s>]*nhentaimg\.com\/018\/[a-z0-9_-]+\/)(\d+)t\.(jpg|png|webp|gif)/gi;
  const xxxUrls: { num: number; url: string }[] = [];
  const seenNums = new Set<number>();
  let xm: RegExpExecArray | null;

  while ((xm = xxxRe.exec(raw)) !== null) {
    const prefix = xm[1];
    const pageNum = parseInt(xm[2], 10);
    if (seenNums.has(pageNum)) continue;
    seenNums.add(pageNum);
    // nhentaimg.com full sayfaları .webp olarak sunulur
    xxxUrls.push({ num: pageNum, url: `${prefix}${pageNum}.webp` });
  }

  if (xxxUrls.length > 0) {
    xxxUrls.sort((a, b) => a.num - b.num);
    return xxxUrls.map((u) => u.url);
  }

  // B) t.nhentai.net (nhentai.net):
  // Thumbnail: https://t.nhentai.net/galleries/1556093/1t.jpg -> https://i.nhentai.net/galleries/1556093/1.jpg
  const urls: string[] = [];
  const re = /https:\/\/t\d*\.nhentai\.net\/galleries\/(\d+)\/(\d+)t\.(jpg|png|webp|gif)/gi;
  let m: RegExpExecArray | null;
  const seenPages = new Set<number>();

  while ((m = re.exec(raw)) !== null) {
    const mediaId = m[1];
    const pageNum = parseInt(m[2], 10);
    const ext = m[3].toLowerCase();
    if (seenPages.has(pageNum)) continue;
    seenPages.add(pageNum);
    urls.push(`${NHENTAI_IMAGE_BASE}/galleries/${mediaId}/${pageNum}.${ext}`);
  }

  if (urls.length > 0) {
    urls.sort((a, b) => {
      const numA = parseInt(a.match(/\/(\d+)\.[^.]+$/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/\/(\d+)\.[^.]+$/)?.[1] || '0', 10);
      return numA - numB;
    });
    return urls;
  }

  return [];
}

/**
 * nhentai galeri detay sayfasından (HTML) kategorize edilmiş etiketleri ayıklar.
 * Kategoriler:
 * - /artist/ -> artist
 * - /character/ -> character
 * - /parody/ -> copyright
 * - /tag/ -> general
 * - /group/, /language/, /category/ -> meta
 */
export function parseNHentaiTagsFromHtml(html: string): { tags: BooruTagGroups; allTags: string[] } {
  const tagGroups: BooruTagGroups = {
    artist: [],
    character: [],
    copyright: [],
    general: [],
    meta: ['manga'],
  };
  const allTags: string[] = [];
  if (!html) return { tags: tagGroups, allTags };

  // Not: nhentai.xxx detay sayfası tek tırnak kullanır (href='/tag/...'),
  // /tags/ listesi çift tırnak kullanır — ikisi de desteklenir.
  const re = /<a[^>]+href=(["'])\/(tag|artist|character|parody|group|language|category)\/([^"'\/]+)\/?\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((m = re.exec(html)) !== null) {
    const type = m[2].toLowerCase();
    const inner = m[4];
    const nameM =
      inner.match(/<span[^>]*class=['"]tag_name(?:\s+[^'"]*)?['"][^>]*>([^<]+)<\/span>/i) ||
      inner.match(/<span[^>]*class=['"]name['"][^>]*>([^<]+)<\/span>/i);
    let name = nameM ? decodeEntities(nameM[1]).trim() : decodeEntities(m[3]).replace(/-/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    allTags.push(name);

    if (type === 'artist' || type === 'group') tagGroups.artist.push(name);
    else if (type === 'character') tagGroups.character.push(name);
    else if (type === 'parody') tagGroups.copyright.push(name);
    else if (type === 'tag') tagGroups.general.push(name);
    else if (type === 'language' || type === 'category') tagGroups.meta.push(name);
  }

  return { tags: tagGroups, allTags };
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

  const headers = {
    'User-Agent': NHENTAI_UA,
    Referer: `${NHENTAI_BASE}/`,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'application/json,*/*',
    'Accept-Encoding': 'gzip, deflate, identity',
  };

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
  const v2Text = await fetchWithTimeout(`${NHENTAI_API_BASE}/galleries/${rawId}`, 8000);
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

/** Aynadaki (nhentai.xxx) favori sayısı: `<span class="fv_cnt">107</span>` */
export function parseNHentaiFavoritesFromHtml(html: string): number {
  if (!html) return 0;
  const m = html.match(/class=["'][^"']*fv_cnt[^"']*["'][^>]*>([^<]+)</i);
  if (!m) return 0;
  const raw = decodeEntities(m[1]).trim();
  const km = raw.match(/([\d.,]+)\s*([KMB])?/i);
  if (!km) return 0;
  const val = parseFloat(km[1].replace(/,/g, ''));
  if (!Number.isFinite(val)) return 0;
  const unit = (km[2] || '').toUpperCase();
  return Math.round(val * (unit === 'K' ? 1000 : unit === 'M' ? 1000000 : unit === 'B' ? 1e9 : 1));
}

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
        headers: {
          'User-Agent': NHENTAI_UA,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate, identity',
        },
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
 * Sıra: yerel havuz (anında) -> resmi v2 POST /api/v2/tags/search -> ayna /tags/ scrape.
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
