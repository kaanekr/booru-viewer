import type { NavigatorScreenParams } from '@react-navigation/native';
import type { BooruPost, SearchFilterConfig } from '../types/booru';

export type SearchMode = 'replace' | 'add' | 'exclude';

export type TabParamList = {
  Feed: undefined;
  Search: { tag?: string; mode?: SearchMode } | undefined;
  Favorites: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
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

// Re-export for convenience
export type { BooruPost };
