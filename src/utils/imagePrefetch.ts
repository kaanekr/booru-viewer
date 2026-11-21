import { Image } from 'expo-image';
import { getMediaHeaders, getMediaUrl, isImageMediaUrl } from './media';

/**
 * Prefetches grid thumbnail URLs directly into expo-image's disk cache with
 * bounded concurrency so pagination does not starve active cards or flood RAM.
 */
export function prefetchGridImages(
  rawUrls: (string | undefined)[],
  maxConcurrent: number = 4
): void {
  if (typeof Image?.prefetch !== 'function') return;
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawUrls) {
    if (!raw || !isImageMediaUrl(raw)) continue;
    const resolved = getMediaUrl(raw);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    queue.push(resolved);
  }
  if (queue.length === 0) return;

  let cursor = 0;
  const workerCount = Math.min(Math.max(1, maxConcurrent), queue.length);
  const runWorker = async () => {
    while (cursor < queue.length) {
      const target = queue[cursor++];
      try {
        await Image.prefetch(target, {
          cachePolicy: 'disk',
          headers: getMediaHeaders(target),
        });
      } catch {}
    }
  };
  for (let i = 0; i < workerCount; i++) {
    void runWorker();
  }
}
