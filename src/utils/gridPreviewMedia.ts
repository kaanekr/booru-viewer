import { isGifMediaPost } from './gifMedia';

type PreviewPost = {
  previewUrl?: string;
  previewVideoUrl?: string;
  previewThumbUrl?: string;
  previewThumbs?: string[];
  sampleUrl?: string;
  originalUrl?: string;
  sourceId?: string;
  fileExt?: string;
  tags?: { general?: string[]; meta?: string[] };
};

/** Listing URLs may be HTML-escaped or protocol-relative. Never infer a stream from a watch-page link. */
export function normalizePreviewUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim().replace(/&amp;/gi, '&');
  if (url.startsWith('//')) return `https:${url}`;
  return /^https?:\/\//i.test(url) ? url : '';
}

const pathOf = (url: string) => url.split(/[?#&]/)[0].toLowerCase();
const videoPath = (url: string) => /\.(mp4|webm|mov|m4v|m3u8)$/.test(pathOf(url));
const imagePath = (url: string) => /\.(jpe?g|png|webp|avif|gif|svg|bmp)$/.test(pathOf(url));

function supported(url: string, platform: string): boolean {
  const path = pathOf(url);
  return platform !== 'ios' || (!path.endsWith('.webm') && !/\.av1(?:\.|$)/.test(path));
}

/** Auto previews use listing clips/samples; full originals are allowed only on an explicit hold. */
export function getGridPreviewVideoCandidates(post: PreviewPost, platform: string, allowOriginal = false): string[] {
  // A GIF is never a motion preview: Realbooru lists no extension and the
  // guessed `.mp4` 404s, so keep the card on its thumbnail cover.
  if (isGifMediaPost(post)) return [];
  const result: string[] = [];
  const add = (value: unknown, explicit = false) => {
    const url = normalizePreviewUrl(value);
    if (!url || !supported(url, platform) || imagePath(url)) return;
    if (!videoPath(url) && (!explicit || /\.(html?|php|json|zip)$/.test(pathOf(url)))) return;
    if (!result.includes(url)) result.push(url);
  };
  add(post.previewVideoUrl, true);
  const original = normalizePreviewUrl(post.originalUrl);
  // Several adapters alias sampleUrl to the full attachment. That is not a
  // lightweight listing preview (Cum.st attachments can be very large).
  if (allowOriginal || normalizePreviewUrl(post.previewUrl) !== original) add(post.previewUrl);
  if (allowOriginal || normalizePreviewUrl(post.sampleUrl) !== original) add(post.sampleUrl);
  if (allowOriginal) add(post.originalUrl);
  return result;
}

/** Frame fallback is bounded to image URLs; a sample GIF can animate without a native video player. */
export function getGridPreviewFrames(post: PreviewPost): string[] {
  const raw: unknown[] = Array.isArray(post.previewThumbs) ? [...post.previewThumbs] : [];
  if (post.previewThumbUrl) raw.push(post.previewThumbUrl);
  const sample = normalizePreviewUrl(post.sampleUrl);
  if (pathOf(sample).endsWith('.gif') && sample !== normalizePreviewUrl(post.previewUrl)) raw.push(sample);
  return Array.from(new Set(raw.map(normalizePreviewUrl)
    .filter((url) => !!url && !videoPath(url) && !/\.(html?|php|json|zip)$/.test(pathOf(url))))).slice(0, 32);
}
