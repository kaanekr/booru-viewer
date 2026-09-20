import type { BooruPost, BooruSource } from '../types/booru';

/**
 * Pornhub entegrasyonu — saf yardımcılar.
 *
 * Kaynak: Derfirm/pornhub-api'nin kullandığı resmi Webmasters API
 * (https://www.pornhub.com/webmasters), canlı doğrulandı:
 * - Arama: GET /webmasters/search?search=<kelime>&page=<N>&thumbsize=medium
 *   [&ordering=featured|newest|mostviewed|rating][&period=weekly|monthly|alltime]
 *   [&tags[]=<a,b>][&category=<ad>]
 * - Kart başına video meta (başlık, süre, izlenme, rating, thumb, tags,
 *   categories, pornstars) JSON döner; oynatılabilir dosya YOKTUR.
 * - Oynatma: detay sayfasındaki (view_video.php) `mediaDefinitions`
 *   JSON'undan HLS master URL'leri çıkarılır; viewer açılışında taze
 *   çözülür (URL'ler süreli token taşır, cache'lenmez).
 *
 * React import'u YOK — saf bağımsız fonksiyonlar.
 */

export const PORNHUB_BASE = 'https://www.pornhub.com';
export const PORNHUB_API_BASE = 'https://www.pornhub.com/webmasters';

export const PORNHUB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export type PornhubOrdering = 'featured' | 'newest' | 'mostviewed' | 'rating';
export type PornhubPeriod = 'weekly' | 'monthly' | 'alltime';

export interface PornhubThumb {
  size?: string;
  width?: string;
  height?: string;
  src?: string;
}

export interface PornhubVideo {
  video_id: string;
  title?: string;
  url?: string;
  duration?: string;
  views?: number;
  rating?: number;
  ratings?: number;
  default_thumb?: string;
  thumb?: string;
  publish_date?: string;
  thumbs?: PornhubThumb[];
  tags?: { tag_name?: string }[];
  categories?: { category?: string }[];
  pornstars?: { pornstar_name?: string }[];
}

/** Uygulamanın TimeRangeOption karşılığı: 1w->weekly, 1m->monthly, 1y/1d->alltime */
export function pornhubPeriodForTimeRange(timeRange: string | undefined): PornhubPeriod {
  if (timeRange === '1w') return 'weekly';
  if (timeRange === '1m') return 'monthly';
  return 'alltime';
}

export function buildPornhubSearchUrl(
  page: number,
  query: string,
  ordering?: PornhubOrdering,
  period?: PornhubPeriod
): string {
  const qp = new URLSearchParams();
  qp.set('search', (query || '').trim());
  qp.set('page', String(Math.max(1, Math.floor(page || 1))));
  qp.set('thumbsize', 'medium');
  if (ordering) qp.set('ordering', ordering);
  if (period && ordering) qp.set('period', period);
  return `${PORNHUB_API_BASE}/search?${qp.toString()}`;
}

function normalizeTag(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseDurationToSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const parts = duration.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  let total = 0;
  for (const n of parts) total = total * 60 + n;
  return total;
}

/**
 * Webmasters API videosunu BooruPost'a çevirir. Site tamamen videodur;
 * oynatılabilir URL süreli token'lıdır, liste anında gömülmez —
 * viewer açılışında detaydan taze çözülür (xvideos ile aynı desen).
 */
export function mapPornhubVideoToPost(v: PornhubVideo, source: BooruSource): BooruPost | null {
  if (!v || !v.video_id) return null;
  const thumb = (v.thumb || v.default_thumb || '').trim();
  if (!thumb) return null;

  let width = 640;
  let height = 360;
  const firstThumb = Array.isArray(v.thumbs) ? v.thumbs[0] : undefined;
  if (firstThumb) {
    const w = parseInt(String(firstThumb.width || ''), 10);
    const h = parseInt(String(firstThumb.height || ''), 10);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 && w < 8000 && h < 8000) {
      width = w;
      height = h;
    }
  }

  const tags = Array.isArray(v.tags)
    ? v.tags.map((t) => normalizeTag(String(t?.tag_name || ''))).filter(Boolean)
    : [];
  const categories = Array.isArray(v.categories)
    ? v.categories.map((c) => normalizeTag(String(c?.category || ''))).filter(Boolean)
    : [];
  const artists = Array.isArray(v.pornstars)
    ? v.pornstars.map((p) => normalizeTag(String(p?.pornstar_name || ''))).filter(Boolean)
    : [];

  const rating = typeof v.rating === 'number' ? v.rating : 0;
  const views = typeof v.views === 'number' ? v.views : 0;

  let createdAt = new Date().toISOString();
  if (v.publish_date) {
    // "2025-11-10 20:09:26" -> ISO
    const iso = v.publish_date.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
  }

  return {
    id: `ph_${v.video_id}`,
    sourceId: source.id,
    sourceName: source.name,
    title: (v.title || '').trim() || undefined,
    previewUrl: thumb,
    sampleUrl: thumb,
    originalUrl: '',
    width,
    height,
    aspectRatio: width > 0 && height > 0 ? width / height : 16 / 9,
    rating: 'e',
    score: Math.round(rating * 100),
    favCount: typeof v.ratings === 'number' ? v.ratings : views,
    tags: {
      artist: artists,
      character: [],
      copyright: categories,
      general: tags,
      meta: ['video', `duration:${parseDurationToSeconds(v.duration)}s`],
    },
    allTags: [...artists, ...categories, ...tags],
    sourceLink: (v.url || '').trim() || `${PORNHUB_BASE}/view_video.php?viewkey=${v.video_id}`,
    fileExt: 'mp4',
    createdAt,
  };
}

export interface PornhubFiles {
  high: string;
  low: string;
  hls: string;
}

function decodeScriptValue(s: string): string {
  return s
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Detay sayfası HTML'indeki `mediaDefinitions` JSON'undan oynatılabilir
 * HLS URL'lerini çıkarır (öncelik: defaultQuality → en yüksek quality).
 */
export function parsePornhubDetail(html: string): PornhubFiles {
  const out: PornhubFiles = { high: '', low: '', hls: '' };
  if (!html || !html.includes('mediaDefinitions')) return out;

  // Detay sayfası mediaDefinitions'ı çift-kaçışlı bir JS stringinin içinde
  // gömer (\"group\"...); tek-kaçışlı varyanta normalize et.
  let src = html;
  if (src.includes('mediaDefinitions\\":')) {
    src = src.replace(/\\"/g, '"');
  }

  const re =
    /\{"group":\d+,"height":(\d+),"width":(\d+),"defaultQuality":(true|false),"format":"(hls|mp4)","videoUrl":"((?:[^"\\]|\\.)*)","quality":"?([^",}]*)/g;
  let m: RegExpExecArray | null;
  const hls: { url: string; quality: number; isDefault: boolean }[] = [];
  while ((m = re.exec(src)) !== null) {
    const format = m[4];
    if (format !== 'hls') continue;
    const url = decodeScriptValue(m[5]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const q = parseInt(m[6], 10);
    hls.push({ url, quality: Number.isFinite(q) ? q : 0, isDefault: m[3] === 'true' });
  }
  if (hls.length === 0) return out;

  hls.sort((a, b) => b.quality - a.quality);
  const def = hls.find((h) => h.isDefault);
  out.high = hls[0].url;
  out.low = hls[hls.length - 1].url;
  out.hls = def ? def.url : hls[0].url;
  return out;
}
