import type { BooruPost, BooruSource } from '../types/booru';

/**
 * XHamster (https://xhamster.com) entegrasyonu — saf yardımcılar.
 *
 * Arama ve sayfalama yapısı (canlı doğrulandı):
 * - Arama: GET /search/<slug>?quality=720p[&sort=views|newest|best|longest][&date=latest|weekly|monthly|yearly][&page=N]
 * - Aramasız liste: GET /newest[/<sayfa>] veya /best[/<sayfa>]
 * - Kartlar: `div.video-thumb[data-video-id]`
 *   - a[data-role="thumb-link"] -> href, data-previewvideo mp4, aria-label title
 *   - img[data-role="thumb-preview-img"] -> src thumbnail
 *   - [data-role="video-duration"] -> süre metni
 *   - [data-role="video-uploader-link"] / video-uploader__name -> yükleyici
 *   - video-thumb-views -> izlenme sayısı
 * - Detay: script#initials-script (window.initials) JSON + xplayerSettings.sources.hls
 *   (regex fallback: _TPL_.(h264|av1).mp4.m3u8) + noscript/standart mp4 alanları.
 *
 * React import'u YOK — saf bağımsız fonksiyonlar.
 */

export const XHAMSTER_BASE = 'https://xhamster.com';

export const XHAMSTER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

export type XHamsterSort = 'views' | 'newest' | 'best' | 'longest' | 'relevance';
export type XHamsterDate = 'latest' | 'weekly' | 'monthly' | 'yearly';

/**
 * Uygulamanın TimeRangeOption karşılığı:
 * 1d -> latest, 1w -> weekly, 1m -> monthly, 1y -> yearly
 */
export function xhamsterDateForTimeRange(timeRange: string | undefined): XHamsterDate | undefined {
  if (timeRange === '1d') return 'latest';
  if (timeRange === '1w') return 'weekly';
  if (timeRange === '1m') return 'monthly';
  if (timeRange === '1y') return 'yearly';
  return undefined;
}

export function buildXhamsterSearchUrl(
  baseUrl: string,
  page: number,
  query: string,
  sort?: XHamsterSort,
  date?: XHamsterDate
): string {
  return buildXhamsterSearchCandidates(baseUrl, page, query, sort, date)[0];
}

/**
 * Sırayla denenecek arama/gözatma aday URL'leri.
 * İlk dolu sonuç kazanır, 404 sonraki adayı tetikler.
 */
export function buildXhamsterSearchCandidates(
  baseUrl: string,
  page: number,
  query: string,
  sort?: XHamsterSort,
  date?: XHamsterDate
): string[] {
  const base = (baseUrl || XHAMSTER_BASE).replace(/\/$/, '');
  const keyword = (query || '').trim();
  const pageNum = Math.max(1, Math.floor(page || 1));

  // Aramasız gözatma (browse)
  if (!keyword) {
    if (sort === 'best') {
      if (pageNum <= 1) return [`${base}/best`, `${base}/best/1`];
      return [`${base}/best/${pageNum}`, `${base}/best?page=${pageNum}`];
    }
    if (sort === 'views') {
      if (date === 'latest') {
        if (pageNum <= 1) return [`${base}/best/daily`, `${base}/best/daily/1`];
        return [`${base}/best/daily/${pageNum}`, `${base}/best/daily?page=${pageNum}`];
      }
      if (date === 'weekly') {
        if (pageNum <= 1) return [`${base}/best/weekly`, `${base}/best/weekly/1`];
        return [`${base}/best/weekly/${pageNum}`, `${base}/best/weekly?page=${pageNum}`];
      }
      if (date === 'monthly') {
        if (pageNum <= 1) return [`${base}/best/monthly`, `${base}/best/monthly/1`];
        return [`${base}/best/monthly/${pageNum}`, `${base}/best/monthly?page=${pageNum}`];
      }
      if (pageNum <= 1) return [`${base}/best`, `${base}/newest`, base];
      return [`${base}/best/${pageNum}`, `${base}/newest/${pageNum}`, `${base}/${pageNum}`];
    }
    if (sort === 'longest') {
      if (pageNum <= 1) return [`${base}/newest`, base];
      return [`${base}/newest/${pageNum}`, `${base}/${pageNum}`];
    }
    // Varsayılan / 'newest' — keşfet sayfa 1: anasayfa (günlük seçki) önce
    if (pageNum <= 1) return [base, `${base}/newest`, `${base}/newest/1`];
    return [`${base}/newest/${pageNum}`, `${base}/newest?page=${pageNum}`, `${base}/${pageNum}`];
  }

  // Arama URL'leri
  const qp = new URLSearchParams();
  if (sort && sort !== 'relevance') qp.set('sort', sort);
  if (date) qp.set('date', date);
  if (pageNum > 1) qp.set('page', String(pageNum));

  const qs = qp.toString();
  const slug = encodeURIComponent(keyword);

  const candidates: string[] = [
    `${base}/search/${slug}${qs ? `?${qs}` : ''}`,
    `${base}/search?q=${slug}${qs ? `&${qs}` : ''}`,
  ];

  if (sort || date) {
    const fallbackQp = new URLSearchParams();
    if (pageNum > 1) fallbackQp.set('page', String(pageNum));
    const fallbackQs = fallbackQp.toString();
    candidates.push(`${base}/search/${slug}${fallbackQs ? `?${fallbackQs}` : ''}`);
    candidates.push(`${base}/search?q=${slug}${fallbackQs ? `&${fallbackQs}` : ''}`);
  }

  return candidates;
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

function parseViews(v: string | undefined): number {
  if (!v) return 0;
  const clean = v.replace(/views?/i, '').replace(/,/g, '').trim();
  const mult =
    clean.endsWith('K') || clean.endsWith('k')
      ? 1e3
      : clean.endsWith('M') || clean.endsWith('m')
      ? 1e6
      : clean.endsWith('B') || clean.endsWith('b')
      ? 1e9
      : 1;
  const num = parseFloat(clean);
  return Number.isFinite(num) ? Math.round(num * mult) : 0;
}

/**
 * XHamster arama/liste HTML'inden gönderileri ayıklar.
 */
export function parseXhamsterListing(html: string, source: BooruSource): BooruPost[] {
  const posts: BooruPost[] = [];
  const seen = new Set<string>();
  const base = (source.baseUrl || XHAMSTER_BASE).replace(/\/$/, '');

  const initVideoMap = new Map<string, any>();
  const initMatch = html.match(/<script id=['"]initials-script['"]>window\.initials=([\s\S]*?)<\/script>/);
  if (initMatch) {
    try {
      const raw = initMatch[1].trim().replace(/;$/, '');
      const parsed = JSON.parse(raw);
      const scan = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            if (item && typeof item === 'object' && item.id != null && (item.thumbURL || item.imageURL)) {
              initVideoMap.set(String(item.id), item);
            }
          }
          for (const item of obj) scan(item);
        } else {
          for (const k of Object.keys(obj)) scan(obj[k]);
        }
      };
      scan(parsed);
    } catch {}
  }

  // Kartlar data-video-id="..." içeren video-thumb düğümleridir
  const chunks = html.split(/<div[^>]*data-video-id="/);
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];
    const idM = c.match(/^(\d+)"/);
    if (!idM) continue;
    const videoId = idM[1];
    if (seen.has(videoId)) continue;

    // Bağlantı (href)
    const hrefM = c.match(/<a[^>]*href="([^"]+)"[^>]*data-role="thumb-link"/i) || c.match(/href="([^"]+)"/);
    let href = hrefM ? decodeEntities(hrefM[1]) : '';
    if (href.startsWith('/')) href = `${base}${href}`;

    // data-previewvideo / trailer mp4
    const initData = initVideoMap.get(videoId);
    let previewVideo = '';
    if (initData?.trailerFallbackUrl && typeof initData.trailerFallbackUrl === 'string') {
      previewVideo = initData.trailerFallbackUrl.replace(/\\/g, '');
    } else if (initData?.trailerURL && typeof initData.trailerURL === 'string') {
      previewVideo = initData.trailerURL.replace(/\\/g, '');
    } else {
      const prevM = c.match(/data-previewvideo="([^"]+)"/i);
      const prevFallbackM = c.match(/data-previewvideo-fallback="([^"]+)"/i);
      if (prevFallbackM && prevFallbackM[1].endsWith('.mp4')) {
        previewVideo = prevFallbackM[1];
      } else if (prevM) {
        previewVideo = prevM[1];
      }
    }
    if (previewVideo) {
      previewVideo = decodeEntities(decodeScriptValue(previewVideo));
      if (previewVideo.startsWith('//')) {
        previewVideo = `https:${previewVideo}`;
      }
      // XHamster CDN hem av1 hem h264 üretir. iOS AVPlayer av1 çözemez (hata + donma).
      // av1 token'ını h264'e çevir; her zaman birebir karşılığı olan akıcı mp4 açılır.
      previewVideo = previewVideo
        .replace(/([._-])av1([._-])/gi, '$1h264$2')
        .replace(/\.av1\./gi, '.h264.');
    }

    // Küçük resim: önce initials JSON (lazy kartlarda DOM'da img yok),
    // sonra mevcut srcset/src mantığı.
    let thumbUrl = '';
    if (initData?.thumbURL && typeof initData.thumbURL === 'string') {
      thumbUrl = initData.thumbURL.replace(/\\\//g, '/');
    } else if (initData?.imageURL && typeof initData.imageURL === 'string') {
      thumbUrl = initData.imageURL.replace(/\\\//g, '/');
    }
    if (!thumbUrl) {
    const roleImgM =
      c.match(/<img[^>]*data-role="thumb-preview-img"[^>]*>/i) || c.match(/<img[^>]*>/i);
    // Lazy-load varyantları (data-thumb-url / data-src / data-original) önce;
    // placeholder data:image/* reddedilir; sonra grid dostu küçük srcset, en son src.
    const pickAttr = (tag: string): string => {
      const m =
        tag.match(/data-thumb-url="([^"]+)"/i) ||
        tag.match(/data-src="([^"]+)"/i) ||
        tag.match(/data-original="([^"]+)"/i);
      return m ? m[1] : '';
    };
    if (roleImgM) {
      const tag = roleImgM[0];
      // Lazy-load gerçek URL varsa en önce o (placeholder data:image/* atlanır)
      const lazyRaw = pickAttr(tag);
      if (lazyRaw && !lazyRaw.startsWith('data:image/')) {
        thumbUrl = decodeEntities(lazyRaw);
      }
      const srcsetM =
        tag.match(/srcset="([^"]+)"/i) ||
        c.match(/<img[^>]*data-role="thumb-preview-img"[^>]*srcset="([^"]+)"/i);
      if (!thumbUrl && srcsetM) {
        const rawSrcset = decodeEntities(srcsetM[1]);
        const tokens = rawSrcset.trim().split(/\s*,\s*(?=[^,]*\s+\d+w|\s*$)/);
        const pairs = tokens.map((t) => {
          const p = t.trim().split(/\s+/);
          return { u: p[0], w: p[1] ? parseInt(p[1].replace('w', ''), 10) : 0 };
        });
        const good = pairs.find((p) => p.w >= 500) || pairs[pairs.length - 1];
        thumbUrl = (good?.u || tokens[0].trim().split(/\s+/)[0]).replace(/,$/, '');
      }
      if (!thumbUrl || thumbUrl.startsWith('data:image/')) {
        thumbUrl = '';
        const srcM = tag.match(/src="([^"]+)"/i);
        if (srcM) {
          const raw = decodeEntities(srcM[1]);
          if (!raw.startsWith('data:image/')) thumbUrl = raw;
        }
      }
    }
    if (!thumbUrl) {
      const imgM = c.match(/<img[^>]*src="([^"]+)"/i);
      thumbUrl = imgM ? decodeEntities(imgM[1]) : '';
    }
    }
    if (thumbUrl) {
      thumbUrl = decodeEntities(decodeScriptValue(thumbUrl));
      if (thumbUrl.startsWith('//')) {
        thumbUrl = `https:${thumbUrl}`;
      }
    }

    // Başlık (initData öncelikli)
    let title = '';
    if (initData?.title && typeof initData.title === 'string') {
      title = initData.title.trim();
    } else {
      const ariaM = c.match(/aria-label="([^"]+)"/i);
      const titleAttrM = c.match(/title="([^"]+)"/i);
      const altM = c.match(/alt="([^"]+)"/i);
      title = ariaM
        ? decodeEntities(ariaM[1]).trim()
        : titleAttrM
        ? decodeEntities(titleAttrM[1]).trim()
        : altM
        ? decodeEntities(altM[1]).trim()
        : '';
    }

    // Süre ([data-role="video-duration"])
    const durM = c.match(/data-role="video-duration"[^>]*>([\s\S]*?)<\/div>/i);
    const duration = durM
      ? durM[1]
          .replace(/<[^>]+>/g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .trim()
      : '';

    // Yükleyici (video-uploader__name / video-uploader-link)
    const upM = c.match(/class="[^"]*video-uploader__name[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const uploader = upM ? decodeEntities(upM[1].replace(/<!--[\s\S]*?-->/g, '').trim()) : '';
    const artist = uploader ? [uploader] : [];

    // İzlenme sayısı (video-thumb-views)
    const viewsM = c.match(/class="[^"]*video-thumb-views[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const viewsStr = viewsM ? viewsM[1].replace(/<[^>]+>/g, '').trim() : '';
    const score = parseViews(viewsStr);

    seen.add(videoId);
    posts.push({
      id: `xh_${videoId}`,
      sourceId: source.id,
      sourceName: source.name,
      title: title || undefined,
      previewUrl: thumbUrl || previewVideo,
      previewVideoUrl: previewVideo || undefined,
      previewThumbUrl: undefined,
      previewThumbs: undefined,
      sampleUrl: previewVideo || thumbUrl,
      // Per-card data-previewvideo mp4: anlık sampleUrl/originalUrl fallback;
      // tam dosya viewer açılışında detaydan tembel (lazy) çözülür.
      originalUrl: previewVideo || '',
      width: 1280,
      height: 720,
      aspectRatio: 16 / 9,
      rating: 'e',
      score,
      favCount: score,
      tags: {
        artist,
        character: [],
        copyright: [],
        general: duration ? [`duration:${duration}`] : [],
        meta: ['video'],
      },
      allTags: [...artist, ...(duration ? [`duration:${duration}`] : []), 'video'],
      sourceLink: href,
      fileExt: 'mp4',
      createdAt: new Date().toISOString(),
    });
  }

  return posts;
}

export interface XHamsterFiles {
  high: string;
  low: string;
  hls: string;
  title?: string;
  tags?: string[];
  uploader?: string;
}

/**
 * XHamster video detay sayfası HTML'inden oynatılabilir URL'leri ayıklar:
 * - window.initials JSON'ından xplayerSettings.sources.hls / standard mp4
 * - Regex fallback: _TPL_.(h264|av1).mp4.m3u8
 * - noscript veya doğrudan HTML'e gömülü .mp4 alanları
 */
export function parseXhamsterDetail(html: string): XHamsterFiles {
  let high = '';
  let low = '';
  let hls = '';
  let title = '';
  let uploader = '';
  const tags: string[] = [];

  // 1. window.initials JSON ayıklama
  try {
    const scriptM =
      html.match(/<script[^>]*id=['"]initials-script['"][^>]*>([\s\S]*?)<\/script>/i) ||
      html.match(/window\.initials\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/i);

    if (scriptM) {
      let rawJson = scriptM[1];
      if (!rawJson.startsWith('{')) {
        const jsonInner = rawJson.match(/window\.initials\s*=\s*(\{[\s\S]*?\});/);
        if (jsonInner) rawJson = jsonInner[1];
      }
      if (rawJson.startsWith('{')) {
        const data = JSON.parse(rawJson);

        // Başlık
        if (typeof data.videoTitle === 'string' && data.videoTitle.trim()) {
          title = data.videoTitle.trim();
        } else if (data.videoTitle && typeof data.videoTitle.pageTitle === 'string') {
          title = data.videoTitle.pageTitle.trim();
        } else if (data.videoEntity && typeof data.videoEntity.title === 'string') {
          title = data.videoEntity.title.trim();
        }

        // Etiketler
        const tagList = data.videoTagsComponent?.tags || data.videoTagsComponent?.models;
        if (Array.isArray(tagList)) {
          for (const item of tagList) {
            if (item && item.name) {
              tags.push(String(item.name).trim());
            }
            if (item && item.isUploader && item.name && !uploader) {
              uploader = String(item.name).trim();
            }
          }
        }

        // Yükleyici
        if (!uploader && data.videoEntity && data.videoEntity.author) {
          uploader = String(data.videoEntity.author).trim();
        }

        // Video kaynakları (xplayerSettings.sources)
        const sources = data.xplayerSettings?.sources;
        if (sources) {
          const h264Hls = sources.hls?.h264?.url || sources.hls?.h264?.fallback;
          const av1Hls = sources.hls?.av1?.url || sources.hls?.av1?.fallback;
          if (h264Hls && /^https?:\/\//i.test(h264Hls)) {
            hls = h264Hls;
          } else if (av1Hls && /^https?:\/\//i.test(av1Hls)) {
            hls = av1Hls;
          }

          const standardH264 = Array.isArray(sources.standard?.h264) ? sources.standard.h264 : [];
          for (const s of standardH264) {
            const u = s?.url || s?.fallback;
            if (u && /^https?:\/\//i.test(u)) {
              const q = parseInt(s.quality, 10);
              if (q >= 720 && !high) high = u;
              else if (!low) low = u;
            }
          }
        }
      }
    }
  } catch {}

  // 2. HLS için fallback: regex ile _TPL_.(h264|av1).mp4.m3u8 veya doğrudan .m3u8
  if (!hls) {
    const tplM = html.match(/(https?:[^\s"'<>]*(?:_TPL_\.(?:h264|av1)\.mp4\.m3u8)[^\s"'<>]*)/i);
    if (tplM) {
      hls = decodeScriptValue(tplM[1]);
      if (hls.includes('_TPL_.av1.mp4.m3u8')) {
        hls = hls.replace('_TPL_.av1.mp4.m3u8', '_TPL_.h264.mp4.m3u8');
      }
    } else {
      const genM = html.match(/((?:https?:)?\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (genM) {
        hls = decodeScriptValue(genM[1]);
        if (hls.startsWith('//')) hls = `https:${hls}`;
      }
    }
  }

  // 3. MP4 için fallback: noscript video öğesi veya gömülü mp4 bağlantıları
  if (!high || !low) {
    const noscriptM =
      html.match(/<video[^>]*class="[^"]*player-container__no-script-video[^"]*"[^>]*src="([^"]+)"/i) ||
      html.match(/<video[^>]*src="([^"]+)"[^>]*class="[^"]*player-container__no-script-video[^"]*"/i) ||
      html.match(/<video[^>]*src="([^"]+)"/i);

    if (noscriptM) {
      const noscriptUrl = decodeScriptValue(noscriptM[1]);
      if (!high) high = noscriptUrl;
      else if (!low) low = noscriptUrl;
    }
  }

  // 4. Çözünürlüklü .h264.mp4 URL'leri
  if (!high || !low) {
    const allMp4s = [...html.matchAll(/(https?:[^\s"'<>]+\/\d+p\.h264\.mp4[^\s"'<>]*)/gi)].map((m) =>
      decodeScriptValue(m[1])
    );
    for (const u of allMp4s) {
      if (u.includes('720p') || u.includes('1080p') || u.includes('480p')) {
        if (!high) high = u;
      } else {
        if (!low) low = u;
      }
    }
  }

  if (high && !low) low = high;
  if (low && !high) high = low;

  return {
    high,
    low,
    hls,
    title: title || undefined,
    tags: tags.length > 0 ? tags : undefined,
    uploader: uploader || undefined,
  };
}
