import type { BooruPost } from '../types/booru';

const cache = new Map<string, BooruPost[]>();
let counter = 0;

function makeKey(): string {
  counter += 1;
  return `posts_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Holds large post arrays here instead of passing them via navigation params. */
export function setCachedPosts(posts: BooruPost[]): string {
  const key = makeKey();
  cache.set(key, posts);
  // Drop old entries to keep memory usage down
  if (cache.size > 20) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return key;
}

export function getCachedPosts(key: string): BooruPost[] {
  return cache.get(key) ?? [];
}

/** Each screen deletes its own entry on close — the map never grows. */
export function deleteCachedPosts(key: string): void {
  cache.delete(key);
}

export function clearCachedPosts(): void {
  cache.clear();
}
