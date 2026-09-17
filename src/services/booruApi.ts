import { BooruPost, BooruSource, BooruTagGroups, BooruTagSuggestion, TagCategory, SearchFilterConfig } from '../types/booru';
import { DEFAULT_SOURCE } from './sources';
import { proxyService } from './proxyService';

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BooruViewer/1.0';

async function fetchBooru(url: string, init?: RequestInit): Promise<Response> {
  const target = proxyService.proxyUrl(url);
  return await fetch(target, init);
}

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
  if (!url) return '';
  let target = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    target = url;
  } else if (url.startsWith('//')) {
    target = `https:${url}`;
  } else {
    target = `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  }
  return proxyService.proxyUrl(target);
}

function normalizeRating(rawRating: string | undefined): 's' | 'q' | 'e' | 'g' {
  if (!rawRating) return 's';
  const lower = rawRating.toLowerCase();
  if (lower === 'general' || lower === 'g' || lower === 'safe' || lower === 's') return 's';
  if (lower === 'questionable' || lower === 'q') return 'q';
  if (lower === 'explicit' || lower === 'e') return 'e';
  return 's';
}

export class BooruApiService {
  private currentSource: BooruSource = DEFAULT_SOURCE;

  setSource(source: BooruSource) {
    this.currentSource = source;
  }

  getSource(): BooruSource {
    return this.currentSource;
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

    // Min Score
    if (filter.minScore && filter.minScore > 0) {
      parts.push(`score:>=${filter.minScore}`);
    }

    // User / Artist / Creator
    if (filter.user && filter.user.trim()) {
      if (activeSource.type === 'cumst') {
        parts.push(`creator:${filter.user.trim()}`);
      } else {
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

    // Historical Leaderboard / Anchor Date
    if (filter.leaderboardDate) {
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

    // Sort By & Time Range
    if (filter.sortBy === 'score') {
      if (activeSource.type === 'gelbooru' || activeSource.type === 'realbooru') {
        parts.push('sort:score:desc');
      } else if (activeSource.type === 'danbooru') {
        if (filter.timeRange === '1d') {
          parts.push('age:1d', 'order:score');
        } else if (filter.timeRange === '1w') {
          parts.push('age:1w', 'order:score');
        } else if (filter.timeRange === '1m') {
          parts.push('age:1m', 'order:score');
        } else if (filter.timeRange === '1y') {
          parts.push('age:1y', 'order:score');
        } else {
          parts.push('order:rank');
        }
      } else if (activeSource.type === 'moebooru') {
        if (filter.timeRange === '1d') {
          parts.push('order:score', 'date:today');
        } else if (filter.timeRange === '1w') {
          parts.push('order:score', 'date:week');
        } else if (filter.timeRange === '1m') {
          parts.push('order:score', 'date:month');
        } else if (filter.timeRange === '1y') {
          parts.push('order:score', 'date:year');
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

  async fetchPostsWithFilter(
    filter: SearchFilterConfig,
    page: number = 1,
    limit: number = 20
  ): Promise<BooruPost[]> {
    const queryTags = this.buildQueryTags(filter);
    return await this.fetchPosts(page, limit, queryTags);
  }

  async fetchPosts(page: number = 1, limit: number = 20, tags: string = ''): Promise<BooruPost[]> {
    const source = this.currentSource;

    try {
      if (source.id === 'gelbooru') {
        return await this.fetchGelbooruScrapedPosts(source, page, limit, tags);
      } else if (source.type === 'gelbooru') {
        return await this.fetchGelbooruPosts(source, page, limit, tags);
      } else if (source.type === 'moebooru') {
        return await this.fetchMoebooruPosts(source, page, limit, tags);
      } else if (source.type === 'realbooru') {
        return await this.fetchRealbooruPosts(source, page, limit, tags);
      } else if (source.type === 'cumst') {
        return await this.fetchCumStPosts(source, page, limit, tags);
      } else {
        return await this.fetchDanbooruPosts(source, page, limit, tags);
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
    tags: string
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const pid = Math.max(0, (page - 1) * 42);
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
      throw new Error(`Gelbooru error: ${response.status} ${response.statusText}`);
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

      let rawOriginal = thumbSrc;
      let rawSample = thumbSrc;
      let fileExt = 'jpg';

      const imgPattern = /https:\/\/([a-z0-9]+)\.gelbooru\.com\/thumbnails\/([a-f0-9]+)\/([a-f0-9]+)\/thumbnail_([a-f0-9]+)\.([a-z0-9]+)/i;
      const imgMatch = thumbSrc.match(imgPattern);

      if (imgMatch) {
        const [, sub, dir1, dir2, hash, ext] = imgMatch;
        fileExt = ext;
        if (isVideo) {
          rawOriginal = `https://${sub}.gelbooru.com/images/${dir1}/${dir2}/${hash}.mp4`;
          rawSample = rawOriginal;
          fileExt = 'mp4';
        } else {
          rawSample = `https://${sub}.gelbooru.com/samples/${dir1}/${dir2}/sample_${hash}.${ext}`;
          rawOriginal = `https://${sub}.gelbooru.com/images/${dir1}/${dir2}/${hash}.${ext}`;
        }
      }

      const previewUrl = ensureAbsoluteUrl(thumbSrc, source.baseUrl);
      const sampleUrl = ensureAbsoluteUrl(rawSample, source.baseUrl);
      const originalUrl = ensureAbsoluteUrl(rawOriginal, source.baseUrl);

      posts.push({
        id: `gelbooru_${id}`,
        sourceId: source.id,
        sourceName: source.name,
        previewUrl,
        sampleUrl,
        originalUrl,
        width: 800,
        height: 1000,
        aspectRatio: 0.75,
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

    return posts;
  }

  private async fetchGelbooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const pid = Math.max(0, page - 1);
    const queryParams = new URLSearchParams({
      page: 'dapi',
      s: 'post',
      q: 'index',
      json: '1',
      limit: String(limit),
      pid: String(pid),
    });
    if (cleanTags) {
      queryParams.append('tags', cleanTags);
    }
    if (source.authParams) {
      const authTokens = new URLSearchParams(source.authParams);
      authTokens.forEach((v, k) => queryParams.append(k, v));
    }

    const url = `${source.baseUrl}/index.php?${queryParams.toString()}`;
    const response = await fetchBooru(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Gelbooru API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((item: any) => item && (item.preview_url || item.sample_url || item.file_url || item.image))
      .map((item: any): BooruPost => {
        let preview = item.preview_url;
        let sample = item.sample_url || item.file_url || preview;
        let original = item.file_url || item.sample_url || preview;

        // Fallback for relative directory + image in Gelbooru
        if (!preview && item.directory !== undefined && item.image) {
          preview = `${source.baseUrl}/thumbnails/${item.directory}/thumbnail_${item.image}`;
        }
        if (!sample && item.directory !== undefined && item.image) {
          sample = `${source.baseUrl}/images/${item.directory}/${item.image}`;
        }
        if (!original && item.directory !== undefined && item.image) {
          original = `${source.baseUrl}/images/${item.directory}/${item.image}`;
        }

        preview = ensureAbsoluteUrl(preview, source.baseUrl);
        sample = ensureAbsoluteUrl(sample, source.baseUrl);
        original = ensureAbsoluteUrl(original, source.baseUrl);

        const width = Number(item.width) || 800;
        const height = Number(item.height) || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;
        const rawTags = Array.from(new Set<string>((item.tags || '').split(' ').filter(Boolean)));

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
          fileExt: item.image ? item.image.split('.').pop() : undefined,
          createdAt: item.change ? new Date(item.change * 1000).toISOString() : new Date().toISOString(),
        };
      });
  }

  private async fetchDanbooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string
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

    return data
      .filter((item: any) => item && (item.file_url || item.large_file_url || item.preview_file_url))
      .map((item: any): BooruPost => {
        const preview = ensureAbsoluteUrl(item.preview_file_url || item.large_file_url || item.file_url, source.baseUrl);
        const sample = ensureAbsoluteUrl(item.large_file_url || item.file_url || item.preview_file_url, source.baseUrl);
        const original = ensureAbsoluteUrl(item.file_url || item.large_file_url || item.preview_file_url, source.baseUrl);

        const width = item.image_width || 800;
        const height = item.image_height || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;

        const artist = Array.from(new Set<string>(item.tag_string_artist ? item.tag_string_artist.split(' ').filter(Boolean) : []));
        const character = Array.from(new Set<string>(item.tag_string_character ? item.tag_string_character.split(' ').filter(Boolean) : []));
        const copyright = Array.from(new Set<string>(item.tag_string_copyright ? item.tag_string_copyright.split(' ').filter(Boolean) : []));
        const general = Array.from(new Set<string>(item.tag_string_general ? item.tag_string_general.split(' ').filter(Boolean) : []));
        const meta = Array.from(new Set<string>(item.tag_string_meta ? item.tag_string_meta.split(' ').filter(Boolean) : []));

        const allTags = Array.from(new Set<string>(item.tag_string ? item.tag_string.split(' ').filter(Boolean) : [...artist, ...character, ...copyright, ...general]));

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
  }

  private async fetchMoebooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string
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

    return data
      .filter((item: any) => item && (item.preview_url || item.sample_url || item.file_url))
      .map((item: any): BooruPost => {
        const preview = ensureAbsoluteUrl(item.preview_url || item.sample_url || item.file_url, source.baseUrl);
        const sample = ensureAbsoluteUrl(item.sample_url || item.file_url || item.preview_url, source.baseUrl);
        const original = ensureAbsoluteUrl(item.file_url || item.sample_url || item.preview_url, source.baseUrl);

        const width = item.width || 800;
        const height = item.height || 1000;
        const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;

        const rawTags = Array.from(new Set<string>((item.tags || '').split(' ').filter(Boolean)));

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
  }

  private async fetchRealbooruPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string
  ): Promise<BooruPost[]> {
    const cleanTags = tags.trim();
    const pid = Math.max(0, (page - 1) * 20);
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

      let fileExt = 'jpeg';
      if (verifiedExt) {
        fileExt = verifiedExt;
      } else if (isVideo) {
        // Realbooru hash yolunda video dosyalarını .mp4 olarak barındırır
        fileExt = 'mp4';
      } else {
        fileExt = 'jpeg';
      }

      let rawOriginal = rawThumb;
      let rawSample = rawThumb;

      if (verifiedOriginalUrl) {
        rawOriginal = verifiedOriginalUrl;
        rawSample = verifiedOriginalUrl;
      } else if (thumbMatch) {
        const [, dir1, dir2, hash] = thumbMatch;
        rawOriginal = `${source.baseUrl}/images/${dir1}/${dir2}/${hash}.${fileExt}`;
        rawSample = rawOriginal;
      }

      const previewUrl = ensureAbsoluteUrl(rawThumb, source.baseUrl);
      const sampleUrl = ensureAbsoluteUrl(rawSample, source.baseUrl);
      const originalUrl = ensureAbsoluteUrl(rawOriginal, source.baseUrl);

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

    return posts;
  }

  private async fetchCumStPosts(
    source: BooruSource,
    page: number,
    limit: number,
    tags: string
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

        const isVideo = att.kind === 'video' || (att.mimeType && att.mimeType.startsWith('video/'));
        const ext =
          att.originalFilename?.split('.').pop() ||
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
              ? p.tags.map((t: any) => (typeof t === 'string' ? t : t.slug || t.label))
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
        const url = `${source.baseUrl}/index.php?page=autocomplete2&term=${encodeURIComponent(query.trim())}&type=tag_query&limit=${limit}`;
        const response = await fetchBooru(url, {
          headers: { 'User-Agent': USER_AGENT, Referer: `${source.baseUrl}/`, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data.slice(0, limit).map((t: any) => {
          let cat: TagCategory = 'general';
          if (t.category === 'artist') cat = 'artist';
          else if (t.category === 'character') cat = 'character';
          else if (t.category === 'copyright') cat = 'copyright';
          else if (t.category === 'metadata') cat = 'meta';

          return {
            name: t.value || t.label,
            category: cat,
            postCount: parseInt(t.post_count, 10) || 0,
          };
        });
      } else if (source.type === 'gelbooru' || source.type === 'realbooru') {
        const url = `${source.baseUrl}/autocomplete.php?q=${encodeURIComponent(query.trim())}`;
        const response = await fetchBooru(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data.slice(0, limit).map((t: any) => {
          let count = 0;
          if (t.label) {
            const match = t.label.match(/\((\d+)\)/);
            if (match) count = parseInt(match[1], 10);
          }
          return {
            name: t.value || t.label,
            category: 'general' as TagCategory,
            postCount: count,
          };
        });
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
              if (c.name) {
                suggestions.push({
                  name: c.name,
                  category: 'artist' as TagCategory,
                  postCount: c.bookmarked || 0,
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
                    t.slug?.toLowerCase().includes(lowerQ) ||
                    t.label?.toLowerCase().includes(lowerQ)
                )
                .slice(0, limit - suggestions.length)
                .map((t: any) => ({
                  name: t.slug || t.label,
                  category: 'general' as TagCategory,
                  postCount: t.posts || 0,
                }));
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

        return data.map((t: any) => ({
          name: t.name,
          category: mapDanbooruCategory(t.category),
          postCount: t.post_count || 0,
        }));
      } else {
        const url = `${source.baseUrl}/tag.json?name=${encodeURIComponent(query.trim())}&order=count&limit=${limit}`;
        const response = await fetchBooru(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data.map((t: any) => ({
          name: t.name,
          category: 'general' as TagCategory,
          postCount: t.count || 0,
        }));
      }
    } catch (e) {
      console.warn('[BooruAPI] Tag autocomplete error:', e);
      return [];
    }
  }
}

export const booruApi = new BooruApiService();
