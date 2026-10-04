import type { BooruPost, BooruSource } from '../types/booru';
import { proxyService } from './proxyService';

/**
 * HentaiHaven (https://hentaihaven.xxx) entegrasyonu - saf yardimcilar.
 * Next.js: ana sayfa + /browse/trending/ + /tag/<slug>/ SSR kart dondurur;
 * /search ve /watch listeleri CSR'dir (duz fetch ile gorunmez).
 * - Kesfet: GET /browse/trending/ (sayfa 1), /browse/trending/page/N/
 * - Arama: etiket slug eslesmesi -> GET /tag/<slug>/ (+ /page/N/).
 *   Serbest metin site aramasi CSR oldugundan desteklenmez; sorgu etiket
 *   slugina normalize edilir, tutmazsa bos doner.
 * - Kartlar SERI duzeyindedir (poster 2/3 + baslik + izlenme + puan).
 * - Izleyici: seri sayfasi -> bolum listesi -> en yeni bolum -> bolum
 *   sayfasi JSON-LD (HLS m3u8) cozumlenir.
 * React importu YOK - node ile dogrudan test edilebilir.
 */

export const HENTAIHAVEN_BASE = 'https://hentaihaven.xxx';

export const HENTAIHAVEN_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

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
 * Kart: aspect-[2/3] poster + baslik + puan + izlenme rozetleri,
 * baglanti /watch/<slug>/.
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
      // Seri sayfasi degil bolum oynar; liste aninda gomulmez -
      // viewer acilisinda seri -> en yeni bolum -> HLS cozulur.
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
}

/**
 * Seri sayfasindan bolumleri cikarir (en yeni ilk). Yalnizca o seriye ait
 * /watch/<slug>/episode-N/ baglantilari alinir (onerilen seriler karismaz).
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
  thumb: string;
  durationSec?: number;
}

/**
 * Bolum detay HTML'inden oynatilabilir dosyayi ayiklar:
 * JSON-LD VideoObject contentUrl (HLS m3u8) + thumbnailUrl + sure.
 */
export function parseHentaiHavenEpisodeDetail(html: string): HentaiHavenFiles {
  const out: HentaiHavenFiles = { hls: '', thumb: '' };
  if (!html) return out;
  const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  const scope = ldM ? ldM[1] : html;

  const hlsM = scope.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
  if (hlsM && /\.m3u8/i.test(hlsM[1].split('?')[0])) {
    out.hls = hlsM[1].trim();
  }
  const thM = scope.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i);
  if (!thM) {
    const thArrM = scope.match(/"thumbnailUrl"\s*:\s*\[\s*"([^"]+)"/i);
    if (thArrM) out.thumb = thArrM[1].trim();
  } else {
    out.thumb = thM[1].trim();
  }
  const durM = scope.match(/"duration"\s*:\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i);
  if (durM && (durM[1] || durM[2] || durM[3])) {
    out.durationSec = (Number(durM[1]) || 0) * 3600 + (Number(durM[2]) || 0) * 60 + (Number(durM[3]) || 0);
  }
  return out;
}

/**
 * Seri -> en yeni bolum -> bolum HLS cozumler (2 atlamali).
 * Akis URL'leri sureli olabilir; BILINCLI olarak cache'lenmez -
 * her viewer acilisinda taze cozulur.
 */
export async function resolveHentaiHavenEpisodeUrls(
  post: { sourceLink?: string },
  signal?: AbortSignal
): Promise<HentaiHavenFiles | null> {
  if (!post.sourceLink || !/^https?:\/\//i.test(post.sourceLink)) return null;

  const headers = {
    'User-Agent': HENTAIHAVEN_UA,
    Referer: HENTAIHAVEN_BASE + '/',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml',
  };
  const fetchHtml = async (url: string, ms: number, label: string): Promise<string | null> => {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), ms);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Dogrudan koparsa kayitli worker varsa tek seferlik oradan denenir.
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
  };

  const seriesHtml = await fetchHtml(post.sourceLink, 10000, 'seri');
  if (!seriesHtml) return null;
  const episodes = parseHentaiHavenEpisodes(seriesHtml, post.sourceLink);
  if (episodes.length === 0) {
    console.warn('[HentaiHaven] bölüm bulunamadı');
    return null;
  }
  const baseM = post.sourceLink.match(/^https?:\/\/[^/]+/i);
  const epUrl = (baseM ? baseM[0] : HENTAIHAVEN_BASE) + episodes[0].url;
  const epHtml = await fetchHtml(epUrl, 10000, 'bölüm');
  if (!epHtml) return null;
  const files = parseHentaiHavenEpisodeDetail(epHtml);
  if (!files.hls) {
    console.warn('[HentaiHaven] HLS bulunamadı');
    return null;
  }
  return files;
}
