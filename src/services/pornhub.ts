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
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

export type PornhubOrdering = 'featured' | 'newest' | 'mostviewed' | 'rating';
export type PornhubPeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';

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
  if (timeRange === '1d') return 'daily';
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

  // Thumbs listesindeki farklı sahne kareleri
  const previewThumbs: string[] = [];
  if (Array.isArray(v.thumbs)) {
    const seenSrcs = new Set<string>();
    for (const t of v.thumbs) {
      if (t && typeof t.src === 'string') {
        const s = t.src.trim();
        if (s && !seenSrcs.has(s)) {
          seenSrcs.add(s);
          previewThumbs.push(s);
        }
      }
    }
  }

  return {
    id: `ph_${v.video_id}`,
    sourceId: source.id,
    sourceName: source.name,
    title: (v.title || '').trim() || undefined,
    previewUrl: thumb,
    previewThumbUrl: previewThumbs[previewThumbs.length - 1],
    previewThumbs: previewThumbs.length > 1 ? previewThumbs : undefined,
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
  const streams: { url: string; quality: number; isDefault: boolean; format: string }[] = [];
  while ((m = re.exec(src)) !== null) {
    const format = m[4];
    const url = decodeScriptValue(m[5]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const q = parseInt(m[6], 10);
    streams.push({
      url,
      quality: Number.isFinite(q) ? q : 0,
      isDefault: m[3] === 'true',
      format,
    });
  }
  if (streams.length === 0) return out;

  const hls = streams.filter((s) => s.format === 'hls');
  const targetStreams = hls.length > 0 ? hls : streams;

  targetStreams.sort((a, b) => b.quality - a.quality);
  const def = targetStreams.find((h) => h.isDefault);
  out.high = targetStreams[0].url;
  out.low = targetStreams[targetStreams.length - 1].url;
  if (hls.length > 0) {
    out.hls = def ? def.url : targetStreams[0].url;
  }
  return out;
}

/**
 * Pornhub HTML arama veya browse sayfasından video kartlarını ayrıştırır.
 * Her karttan hover önizleme videosu (anchor'daki `data-webm` flipbook mp4,
 * iOS'ta oynatılabilir) ve poster/thumb çekilir.
 *
 * Not (2026): eski `data-mediabook` (.webm) özniteliği siteden kalktı;
 * yerini `data-webm="..._fb.mp4"` + `data-poster` + `data-path` aldı.
 * Süre `<span class="bgEffect time">`, izlenme `<div class="videoViews">`,
 * başlık `<a class="thumbnailTitle">` içindedir.
 */
export function parsePornhubHtmlListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  if (!html) return posts;

  const chunks = html.split(/<li[^>]*data-video-vkey=["']/);
  const seen = new Set<string>();

  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];
    const quoteEnd = c.search(/["']/);
    if (quoteEnd === -1) continue;
    const vkey = c.slice(0, quoteEnd).trim();
    if (!vkey || seen.has(vkey)) continue;

    // Önizleme videosu: önce yeni data-webm (mp4 flipbook), sonra eski data-mediabook
    const webmM =
      c.match(/data-webm="([^"]+)"/i) || c.match(/data-mediabook="([^"]+)"/i);
    const previewVideo = webmM ? webmM[1].replace(/&amp;/g, '&').trim() : undefined;

    const posterM = c.match(/data-poster="([^"]+)"/i);
    const poster = posterM ? posterM[1].replace(/&amp;/g, '&').trim() : '';

    // Kapak görseli: data-path > poster > img src (blank.gif atlanır)
    let thumb = '';
    const pathM = c.match(/data-path="([^"]+)"/i);
    if (pathM) {
      const candidate = pathM[1].replace(/&amp;/g, '&').trim();
      if (candidate && !candidate.includes('blank.gif')) thumb = candidate;
    }
    if (!thumb && poster && !poster.includes('blank.gif')) thumb = poster;
    if (!thumb) {
      const imgM =
        c.match(/<img[^>]*class="[^"]*videoThumb[^"]*"[^>]*src="([^"]+)"/i) ||
        c.match(/<img[^>]*src="([^"]+)"/i);
      if (imgM) {
        const candidate = imgM[1].replace(/&amp;/g, '&').trim();
        if (candidate && !candidate.includes('blank.gif')) thumb = candidate;
      }
    }
    if (!thumb) continue;

    const titleM =
      c.match(/<a[^>]*class="thumbnailTitle"[^>]*>([^<]+)<\/a>/i) ||
      c.match(/<img[^>]*alt="([^"]+)"/i) ||
      c.match(/title="([^"]+)"/i);
    const title = titleM ? decodeHtmlEntities(titleM[1]).trim() || undefined : undefined;

    const durM = c.match(/<span[^>]*class="bgEffect time"[^>]*>([^<]+)<\/span>/i);
    const viewsM = c.match(/<div[^>]*class="videoViews"[^>]*>.*?([\d.,]+[KMB]?)/is);

    const generalTags: string[] = [];
    if (durM) generalTags.push(`duration:${durM[1].trim()}`);
    if (viewsM) generalTags.push(`views:${viewsM[1].trim()}`);

    seen.add(vkey);
    posts.push({
      id: `ph_${vkey}`,
      sourceId: source.id,
      sourceName: source.name,
      title,
      previewUrl: thumb,
      previewVideoUrl: previewVideo,
      previewThumbUrl: poster || undefined,
      sampleUrl: previewVideo || thumb,
      originalUrl: '',
      width: 640,
      height: 360,
      aspectRatio: 16 / 9,
      score: 0,
      favCount: 0,
      rating: 'e',
      tags: {
        artist: [],
        character: [],
        copyright: [],
        general: generalTags,
        meta: ['video'],
      },
      allTags: generalTags,
      sourceLink: `${PORNHUB_BASE}/view_video.php?viewkey=${vkey}`,
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  return posts;
}

/** Başlık metnindeki HTML entity'lerini çözer (&#039;, &amp; ...). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = parseInt(n, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const cp = parseInt(n, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
