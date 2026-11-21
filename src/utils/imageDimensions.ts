import { proxyService } from '../services/proxyService';
import { BooruPost } from '../types/booru';
import { LruCache } from './lruCache';

export interface ImageDims {
  width: number;
  height: number;
}

const HEADER_DIMS_CACHE = new LruCache<string, ImageDims | null>(1500);
const NEGATIVE_TTL_MS = 60_000;

function u16BE(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function u16LE(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

function u32BE(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function validDims(width: number, height: number): ImageDims | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 16 || height < 16 || width > 20000 || height > 20000) return null;
  return { width, height };
}

/**
 * Parses width & height from the leading bytes of a JPEG, PNG, GIF, or WebP file
 * without decoding pixels or downloading the full image.
 */
export function parseImageHeaderDimensions(bytes: Uint8Array): ImageDims | null {
  if (!bytes || bytes.length < 10) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return validDims(u32BE(bytes, 16), u32BE(bytes, 20));
  }

  // GIF: GIF87a / GIF89a
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return validDims(u16LE(bytes, 6), u16LE(bytes, 8));
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return validDims(w, h);
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return validDims(u16LE(bytes, 26) & 0x3fff, u16LE(bytes, 28) & 0x3fff);
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const w = 1 + (((b1 & 0x3f) << 8) | b0);
      const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return validDims(w, h);
    }
    return null;
  }

  // JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      while (i < bytes.length && bytes[i] === 0xff) i++;
      if (i >= bytes.length) break;
      const marker = bytes[i++];
      // Standalone markers without length
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (i + 1 >= bytes.length) break;
      const segLen = u16BE(bytes, i);
      if (segLen < 2) break;
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        if (i + 6 >= bytes.length) break;
        const h = u16BE(bytes, i + 3);
        const w = u16BE(bytes, i + 5);
        return validDims(w, h);
      }
      i += segLen;
    }
  }

  return null;
}

async function probeImageHeaderDims(
  url: string,
  referer: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<ImageDims | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (HEADER_DIMS_CACHE.has(url)) {
    return HEADER_DIMS_CACHE.get(url) ?? null;
  }
  if (signal.aborted) return null;

  try {
    const res = await proxyService.fetchWithFallback(
      url,
      {
        headers: {
          Range: 'bytes=0-4095',
          Referer: referer,
          Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8',
        },
        signal,
      },
      timeoutMs
    );
    if (!res.ok && res.status !== 206) {
      HEADER_DIMS_CACHE.set(url, null, NEGATIVE_TTL_MS);
      return null;
    }
    const buf = await res.arrayBuffer();
    const dims = parseImageHeaderDimensions(new Uint8Array(buf));
    if (dims) {
      HEADER_DIMS_CACHE.set(url, dims);
    } else {
      HEADER_DIMS_CACHE.set(url, null, NEGATIVE_TTL_MS);
    }
    return dims;
  } catch {
    return null;
  }
}

/**
 * Probes thumbnail headers (first 4 KB via HTTP Range) in parallel before the page
 * reaches the masonry grid so HTML-scraped sources (Realbooru, Gelbooru scrape) get
 * accurate aspect ratios on first paint with zero mid-scroll layout jumps.
 */
export async function enrichPostAspectRatios(
  posts: BooruPost[],
  referer: string,
  {
    concurrency = 8,
    perRequestTimeoutMs = 2000,
    totalBudgetMs = 1500,
  }: { concurrency?: number; perRequestTimeoutMs?: number; totalBudgetMs?: number } = {}
): Promise<BooruPost[]> {
  if (!posts.length || typeof proxyService?.fetchWithFallback !== 'function') {
    return posts;
  }

  const ctrl = new AbortController();
  const budgetTimer = setTimeout(() => ctrl.abort(), totalBudgetMs);
  let cursor = 0;

  const worker = async () => {
    while (cursor < posts.length && !ctrl.signal.aborted) {
      const idx = cursor++;
      const post = posts[idx];
      const targetUrl = post?.previewUrl;
      if (!targetUrl) continue;
      const dims = await probeImageHeaderDims(targetUrl, referer, ctrl.signal, perRequestTimeoutMs);
      if (dims) {
        post.width = dims.width;
        post.height = dims.height;
        post.aspectRatio = dims.width / dims.height;
      }
    }
  };

  try {
    const workers = Array.from({ length: Math.min(concurrency, posts.length) }, () => worker());
    await Promise.all(workers);
  } finally {
    clearTimeout(budgetTimer);
  }

  return posts;
}
