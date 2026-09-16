import type { BooruPost } from '../types/booru';

const cache = new Map<string, BooruPost[]>();
let counter = 0;

function makeKey(): string {
  counter += 1;
  return `posts_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Büyük post dizilerini navigation params ile geçirmek yerine burada tutar. */
export function setCachedPosts(posts: BooruPost[]): string {
  const key = makeKey();
  cache.set(key, posts);
  // Belleği şişirmemek için eski girişleri at
  if (cache.size > 20) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return key;
}

export function getCachedPosts(key: string): BooruPost[] {
  return cache.get(key) ?? [];
}
