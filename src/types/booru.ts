export type BooruType = 'danbooru' | 'gelbooru' | 'moebooru' | 'realbooru' | 'cumst' | 'redgifs' | 'xvideos' | 'xhamster' | 'pornhub';

export interface BooruSource {
  id: string;
  name: string;
  baseUrl: string;
  type: BooruType;
  description: string;
  isSafeOnly: boolean;
  authParams?: string;
  /** JSON API farklı host'ta ise (örn. Safebooru: safebooru.org) burada tutulur */
  apiBaseUrl?: string;
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
  /** Video kaynaklarındaki içerik başlığı (örn. XVideos); yoksa undefined */
  title?: string;
  previewUrl: string;
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
  sourceLink?: string;
  fileExt?: string;
  fileSize?: number;
  createdAt: string;
}

export interface BooruTagSuggestion {
  name: string;
  category: TagCategory;
  postCount: number;
}

export type SortOption = 'default' | 'id' | 'score' | 'rating' | 'user' | 'height' | 'width';
export type TimeRangeOption = 'all' | '1d' | '1w' | '1m' | '1y';
export type RatingFilterOption = 'all' | 'safe' | 'questionable' | 'explicit';
export type CumstServiceOption = 'all' | 'onlyfans' | 'fansly';
export type CumstMediaTypeOption = 'all' | 'photos' | 'videos' | 'audio' | 'media';

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
