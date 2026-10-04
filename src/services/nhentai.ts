import type { BooruPost, BooruSource, BooruTagGroups } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * nhentai entegrasyonu - saf yardimcilar.
 * nhentai.xxx (Cloudflare bloksuz taze ayna) ve nhentai.net kaynaklarini destekler.
 * - Gorsel CDN: i5.nhentaimg.com (xxx) ve i.nhentai.net (net).
 * - Thumbnail: thumb.jpg / 1t.jpg -> Full: 1.webp / 1.jpg.
 */

export const NHENTAI_BASE = 'https://nhentai.xxx';
export const NHENTAI_IMAGE_BASE = 'https://i.nhentai.net';
export const NHENTAI_THUMB_BASE = 'https://t.nhentai.net';

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
 * Arama ve Keşfet URL adayları (önce nhentai.xxx aynası, sonra net).
 */
export function buildNHentaiSearchCandidates(
  baseUrl: string,
  page: number,
  keyword: string
): string[] {
  const base = (baseUrl || NHENTAI_BASE).replace(/\/$/, '');
  const p = Math.max(1, page);
  const q = (keyword || '').trim();
  if (!q) {
    return [
      p <= 1 ? `${base}/` : `${base}/?page=${p}`,
      `${base}/api/galleries/all?page=${p}`,
      `https://nhentai.net/api/galleries/all?page=${p}`,
    ];
  }
  const encoded = encodeURIComponent(q);
  return [
    `${base}/search/?q=${encoded}&page=${p}`,
    `${base}/api/galleries/search?query=${encoded}&page=${p}`,
    `https://nhentai.net/api/galleries/search?query=${encoded}&page=${p}`,
  ];
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

  // 1) JSON yanıtı: /api/gallery/{id}
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
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
 * nhentai manga sayfalarını çözer (MangaReaderView için).
 * Sırasıyla:
 * 1) Detay sayfası HTML: /g/{id}/
 * 2) JSON API: /api/gallery/{id}
 * 3) Sentetik Güvenlik Ağı (mediaId biliniyorsa)
 */
export async function resolveNHentaiPages(
  post: { id?: string; sourceLink?: string; mediaId?: string; pageCount?: number },
  signal?: AbortSignal
): Promise<string[]> {
  const rawId = (post.id || '').replace(/^nh_/, '');
  if (!rawId) return [];

  const base = post.sourceLink?.match(/^https?:\/\/[^/]+/i)?.[0] || NHENTAI_BASE;

  const headers = {
    'User-Agent': NHENTAI_UA,
    Referer: `${base}/`,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/json,*/*',
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

  // 1. Detay HTML sayfası: /g/{id}/
  const detailUrl = `${base}/g/${rawId}/`;
  const detailText = await fetchWithTimeout(detailUrl, 9000);
  if (detailText) {
    const pages = parseNHentaiGalleryPages(detailText, rawId);
    if (pages.length > 0) return pages;
  }

  // 2. JSON API dene: /api/gallery/{id}
  const jsonUrl = `https://nhentai.net/api/gallery/${rawId}`;
  const jsonText = await fetchWithTimeout(jsonUrl, 8000);
  if (jsonText) {
    const pages = parseNHentaiGalleryPages(jsonText, rawId);
    if (pages.length > 0) return pages;
  }

  // 3. Sentetik Güvenlik Ağı
  if (post.mediaId && post.pageCount && post.pageCount > 0) {
    const synthetic: string[] = [];
    for (let p = 1; p <= post.pageCount; p++) {
      synthetic.push(`${NHENTAI_IMAGE_BASE}/galleries/${post.mediaId}/${p}.jpg`);
    }
    return synthetic;
  }

  return [];
}
