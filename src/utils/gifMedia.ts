/**
 * GIF detection lives in its own dependency-free module so both the viewer
 * (media helpers) and the grid preview policy can share it without pulling in
 * the network/service layer.
 */

type GifCandidatePost = {
  sourceId?: string;
  fileExt?: string;
  originalUrl?: string;
  sampleUrl?: string;
  tags?: { general?: string[]; meta?: string[] };
};

/**
 * Whether a post renders as an animated GIF rather than a video.
 * Realbooru's listing carries no file extension, so the scraper can only guess
 * `.mp4`; the `gif` tag (always without `video`) is the reliable signal. A
 * known extension and the detail-resolved URL take priority when present.
 */
export function isGifMediaPost(
  post: GifCandidatePost | null | undefined,
  resolvedOriginalUrl?: string | null
): boolean {
  if (!post) return false;
  // The detail page is authoritative, including when stale metadata says GIF
  // but the real attachment is a video (or a static image).
  if (resolvedOriginalUrl) {
    const path = resolvedOriginalUrl.split(/[?#]/)[0].toLowerCase();
    if (/\.(gif|mp4|webm|mov|m4v|m3u8|jpe?g|png|webp|avif)$/.test(path)) return path.endsWith('.gif');
  }
  if ((post.fileExt || '').toLowerCase() === 'gif') return true;
  if ((resolvedOriginalUrl || '').split('?')[0].toLowerCase().endsWith('.gif')) return true;
  if (post.sourceId === 'realbooru') {
    const general = (post.tags?.general || []).map((t) => t.toLowerCase());
    const hasVideoTag = general.some((t) => t === 'video' || t === 'webm' || t === 'mp4');
    if (general.includes('gif') && !hasVideoTag) return true;
  }
  return (post.originalUrl || post.sampleUrl || '').split('?')[0].toLowerCase().endsWith('.gif');
}
