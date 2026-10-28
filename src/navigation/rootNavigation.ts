import { createNavigationContainerRef, StackActions } from '@react-navigation/native';
import type { BooruPost, BooruSource, SearchFilterConfig } from '../types/booru';
import type { RootStackParamList } from './types';
import { setCachedPosts } from './postsCache';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Grid to content: push onto the native stack — swipe-back reveals the real screen underneath. */
export function pushViewer(
  posts: BooruPost[],
  initialIndex: number,
  originTags?: string[],
  originFilter?: SearchFilterConfig,
  originSource?: BooruSource
) {
  if (!navigationRef.isReady() || posts.length === 0) return;
  const postsKey = setCachedPosts(posts);
  navigationRef.dispatch(
    StackActions.push('Viewer', {
      postsKey,
      initialIndex: Math.max(0, Math.min(initialIndex, posts.length - 1)),
      originTags,
      originFilter,
      originSource: originSource ? { ...originSource } : undefined,
    })
  );
}

/** From content/grid to a new search: chained push — back returns to content first. */
export function pushSearchDetail(tags: string[], baseFilter?: SearchFilterConfig, source?: BooruSource) {
  if (!navigationRef.isReady()) return;
  const clean = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return;
  navigationRef.dispatch(StackActions.push('SearchDetail', { tags: clean, baseFilter, source: source ? { ...source } : undefined }));
}

export function goBack() {
  if (navigationRef.isReady() && navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
}
