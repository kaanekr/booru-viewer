import { createNavigationContainerRef, StackActions } from '@react-navigation/native';
import type { BooruPost, SearchFilterConfig } from '../types/booru';
import type { RootStackParamList } from './types';
import { setCachedPosts } from './postsCache';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Grid'den içeriğe: native stack'e push — geri kaydırma altta gerçek ekranı gösterir. */
export function pushViewer(
  posts: BooruPost[],
  initialIndex: number,
  originTags?: string[],
  originFilter?: SearchFilterConfig
) {
  if (!navigationRef.isReady() || posts.length === 0) return;
  const postsKey = setCachedPosts(posts);
  navigationRef.dispatch(
    StackActions.push('Viewer', {
      postsKey,
      initialIndex: Math.max(0, Math.min(initialIndex, posts.length - 1)),
      originTags,
      originFilter,
    })
  );
}

/** İçerikten / gridden yeni aramaya: zincirleme push — geri önce içeriğe döner. */
export function pushSearchDetail(tags: string[], baseFilter?: SearchFilterConfig) {
  if (!navigationRef.isReady()) return;
  const clean = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return;
  navigationRef.dispatch(StackActions.push('SearchDetail', { tags: clean, baseFilter }));
}

export function goBack() {
  if (navigationRef.isReady() && navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
}
