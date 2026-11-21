export type BooruType = 'danbooru' | 'gelbooru' | 'moebooru' | 'realbooru' | 'cumst' | 'redgifs' | 'xvideos' | 'xhamster' | 'pornhub' | 'sexcom' | 'hentaihaven' | 'nhentai';

export interface BooruSource {
  id: string;
  name: string;
  baseUrl: string;
  type: BooruType;
  description: string;
  isSafeOnly: boolean;
  authParams?: string;
  /** Kept here when the JSON API lives on a different host */
  apiBaseUrl?: string;
  /** When true, hidden from the source picker (saved preferences keep working) */
  hidden?: boolean;
}

export interface BooruTagGroups {
  artist: string[];
  character: string[];
  copyright: string[];
  general: string[];
  meta: string[];
}

export type TagCategory = 'artist' | 'character' | 'copyright' | 'general' | 'meta';

export interface BooruPost {
  id: string;
  sourceId: string;
  sourceName: string;
  /** Content title on video sources (e.g. XVideos); undefined otherwise */
  title?: string;
  previewUrl: string;
  /** Independent static cover to try if previewUrl fails (for example RedGifs poster). */
  previewFallbackUrl?: string;
  previewVideoUrl?: string;
  previewThumbUrl?: string;
  previewThumbs?: string[];
  sampleUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  aspectRatio: number;
  rating: 's' | 'q' | 'e' | 'g';
  score: number;
  favCount: number;
  tags: BooruTagGroups;
  allTags: string[];
  /** Native query when multiple source tag types share a display category. */
  tagQueries?: Record<string, string>;
  sourceLink?: string;
  fileExt?: string;
  fileSize?: number;
  createdAt: string;
  /** RedGifs category (niche) ids, e.g. ['3-somes', 'natural-tits'] */
  niches?: string[];
  /** Premium-locked content (e.g. sex.com): filtered from lists, preview plays in viewer */
  isPremium?: boolean;
  /** Manga / doujinshi page count and media id (nhentai etc.) */
  pageCount?: number;
  mediaId?: string;
}

export interface BooruTagSuggestion {
  name: string;
  category: TagCategory;
  postCount: number;
  query?: string;
}

export interface RedGifsNiche {
  id: string;
  name: string;
  gifCount: number;
  subscribers: number;
  thumbnail?: string;
}

/** RedGifs trending search terms (tag row in Explore). */
export interface RedGifsTrendingTag {
  name: string;
  count: number;
}

export type SortOption = 'default' | 'id' | 'score' | 'rating' | 'user' | 'height' | 'width';
export type TimeRangeOption = 'all' | '1d' | '1w' | '1m' | '1y';
export type RatingFilterOption = 'all' | 'safe' | 'questionable' | 'explicit';
export type CumstServiceOption = 'all' | 'onlyfans' | 'fansly';
export type CumstMediaTypeOption = 'all' | 'photos' | 'videos' | 'audio';

/**
 * HentaiHaven Explore section. Official v1 API mapping:
 * latest -> hentai/all (paged), trending/yuri/ecchi/incest/tentacle/
 * uncensored -> hentai/home sections, episodes -> home.last_episodes,
 * genre sections paginate from page 2 via genre/{id}?p.
 */
export type HentaiHavenFeedSection =
  | 'latest'
  | 'trending'
  | 'episodes'
  | 'yuri'
  | 'ecchi'
  | 'incest'
  | 'tentacle'
  | 'uncensored';

export interface SearchFilterConfig {
  tags: string[];
  sortBy: SortOption;
  timeRange: TimeRangeOption;
  rating: RatingFilterOption;
  minScore?: number;
  user?: string;
  cumstService?: CumstServiceOption;
  cumstMediaType?: CumstMediaTypeOption;
  leaderboardDate?: string;
  jumpToPage: number;
  includeBlacklisted: boolean;
  autocompleteFromServer: boolean;
  /** Which section backs the HentaiHaven Explore / empty-search feed (ignored on other sources) */
  hentaiHavenSection?: HentaiHavenFeedSection;
}

export const DEFAULT_FILTER_CONFIG: SearchFilterConfig = {
  tags: [],
  sortBy: 'default',
  timeRange: 'all',
  rating: 'all',
  minScore: undefined,
  user: undefined,
  cumstService: 'all',
  cumstMediaType: 'all',
  leaderboardDate: undefined,
  jumpToPage: 1,
  includeBlacklisted: false,
  autocompleteFromServer: true,
};
