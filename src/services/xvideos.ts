import type { BooruPost, BooruSource } from '../types/booru';

/**
 * XVideos (https://www.xvideos.com) entegrasyonu — saf yardımcılar.
 * Kaynak: rodrigogs/xvideos kütüphanesinin kullandığı uçlar (canlı doğrulandı):
 * - Arama: GET /?k=<kelime>&sort=..&durf=..&datef=..&quality=..[&p=<sayfa-1>]
 *   (sayfa 1'de `p` yok; p sıfır tabanlıdır: p=1 → 2. sayfa)
 * - Aramasız liste: GET /new[/<sayfa>] (fresh)
 * - Kartlar: `id="video_<eid>" data-id="<numeric>"` thumb-block div'leri
 * - Detay: html5player.setVideoUrlLow/High (mp4) + setVideoHLS (m3u8),
 *   etiketler: a[href*="/tags/"]
 * React import'u YOK — node ile doğrudan test edilebilir.
 */

export const XVIDEOS_BASE = 'https://www.xvideos.com';

/** Arama/liste HTML'i için desktop UA (mobil UA farklı markup döndürebilir). */
export const XVIDEOS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export type XVideosSort = 'relevance' | 'uploaddate' | 'rating' | 'length' | 'views' | 'random';
export type XVideosDatef = 'today' | 'week' | 'month' | '3month' | '6month' | 'all';

/** Uygulamanın TimeRangeOption karşılığı (1y aralığı sitede yok → 'all'). */
export function xvideosDatefForTimeRange(timeRange: string | undefined): XVideosDatef {
  if (timeRange === '1d') return 'today';
  if (timeRange === '1w') return 'week';
  if (timeRange === '1m') return 'month';
  return 'all';
}

export function buildXVideosSearchUrl(
  baseUrl: string,
  page: number,
  k: string,
  sort: XVideosSort,
  datef: XVideosDatef
): string {
  return buildXVideosSearchCandidates(baseUrl, page, k, sort, datef)[0];
}

/**
 * Sırayla denenecek aday URL'ler (kütüphanenin loadListingPage mantığı):
 * site bazı varyantlarda 404 verir (örn. `/new` 404, `/new/1` 200) ya da
 * boş liste döner; ilk dolu sonuç kazanır.
 */
export function buildXVideosSearchCandidates(
  baseUrl: string,
  page: number,
  k: string,
  sort: XVideosSort,
  datef: XVideosDatef
): string[] {
  const base = (baseUrl || XVIDEOS_BASE).replace(/\/$/, '');
  const keyword = (k || '').trim();
  if (!keyword) {
    if (page <= 1) return [`${base}/new`, `${base}/new/1`];
    return [`${base}/new/${page}`];
  }
  const make = (p: number | undefined): string => {
    const qp = new URLSearchParams({
      k: keyword,
      sort,
      durf: 'allduration',
      datef,
      quality: 'all',
    });
    if (p !== undefined) qp.set('p', String(p));
    return `${base}/?${qp.toString()}`;
  };
  if (page <= 1) return [make(undefined)];
  // p sıfır tabanlıdır (p=1 → 2. sayfa); ikisi de denenir
  return [make(page - 1), make(page)];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeScriptValue(s: string): string {
  return s
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Arama/liste HTML'inden kartları çıkarır. Her kart bir videodur
 * (site tamamen video; fotoğraf yok).
 */
export function parseXVideosListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  const seen = new Set<string>();
  const base = (source.baseUrl || XVIDEOS_BASE).replace(/\/$/, '');

  // Her kart `id="video_<eid>"` ile başlar; parçaya bölüp kart içinden çek.
  const chunks = html.split('id="video_');
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];

    const idM = c.match(/data-id="(\d+)"/);
    const hrefM = c.match(/<a[^>]*href="(\/video\.[^"]+)"/);
    if (!idM || !hrefM) continue;
    const dataId = idM[1];
    if (seen.has(dataId)) continue;

    const thumbM =
      c.match(/data-src="(https?:[^"]+)"/) || c.match(/<img[^>]*src="(https?:[^"]+)"/);
    const preview = thumbM ? thumbM[1].trim() : '';
    if (!preview) continue;

    const titleM =
      c.match(/<p class="title"><a[^>]*title="([^"]+)"/) || c.match(/title="([^"]+)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';

    const profM = c.match(/<span class="name">([^<]+)<\/span>/);
    const profile = profM ? decodeEntities(profM[1]).trim() : '';

    // Kalite işareti (örn. >720p< / >360p<) → 16:9 boyut tahmini
    let height = 720;
    const qM = c.match(/>(\d{3,4})p</);
    if (qM) {
      const q = parseInt(qM[1], 10);
      if (Number.isFinite(q) && q >= 144 && q <= 2160) height = q;
    }
    const width = Math.round((height * 16) / 9);

    const href = decodeEntities(hrefM[1]);
    const artist = profile ? [profile] : [];

    seen.add(dataId);
    posts.push({
      id: `xv_${dataId}`,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: preview,
      sampleUrl: preview,
      // Orijinal mp4 secure-token'lıdır ve süreli olabilir; liste anında
      // gömülmez — viewer açılışında detaydan taze çözülür.
      originalUrl: '',
      width,
      height,
      aspectRatio: width > 0 && height > 0 ? width / height : 16 / 9,
      rating: 'e',
      score: 0,
      favCount: 0,
      tags: {
        artist,
        character: [],
        copyright: [],
        general: [],
        meta: ['video'],
      },
      allTags: [...artist],
      sourceLink: `${base}${href}`,
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  return posts;
}

export interface XVideosFiles {
  high: string;
  low: string;
  hls: string;
}

/** Detay sayfası HTML'inden oynatılabilir dosya URL'lerini çıkarır. */
export function parseXVideosFiles(html: string): XVideosFiles {
  const pick = (patterns: RegExp[]): string => {
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) {
        const v = decodeScriptValue(m[1]);
        if (v) return v;
      }
    }
    return '';
  };

  const low = pick([
    /html5player\.setVideoUrlLow\('([^']+)'/i,
    /html5player\.setVideoUrlLow\("([^"]+)"/i,
    /"videoUrlLow"\s*:\s*"([^"]+)"/i,
  ]);
  const high = pick([
    /html5player\.setVideoUrlHigh\('([^']+)'/i,
    /html5player\.setVideoUrlHigh\("([^"]+)"/i,
    /"videoUrlHigh"\s*:\s*"([^"]+)"/i,
  ]);
  let hls = pick([
    /html5player\.setVideoHLS\('([^']+)'/i,
    /html5player\.setVideoHLS\("([^"]+)"/i,
    /"videoHLS"\s*:\s*"([^"]+)"/i,
    /((?:https:)?\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*)/i,
  ]);
  if (hls.startsWith('//')) hls = `https:${hls}`;

  return { high, low, hls };
}
