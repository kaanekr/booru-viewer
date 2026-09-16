import type { BooruPost, SearchFilterConfig } from '../types/booru';

export type SearchMode = 'replace' | 'add' | 'exclude';

export type RootStackParamList = {
  MainTabs: undefined;
  Viewer: {
    postsKey: string;
    initialIndex: number;
    originTags?: string[];
    originFilter?: SearchFilterConfig;
  };
  SearchDetail: {
    tags: string[];
    baseFilter?: SearchFilterConfig;
  };
};

export type TabParamList = {
  Feed: undefined;
  Search: undefined;
  Favorites: undefined;
  Settings: undefined;
};

// Re-export for convenience
export type { BooruPost };
