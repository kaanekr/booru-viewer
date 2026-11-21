import { Directory, File, Paths } from 'expo-file-system';

function hashVideoCacheKey(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Downloads a video through the app process's NSURLSession into Paths.cache
 * when AVFoundation/mediaserverd fails directly (e.g. -1202 on realbooru.com)
 * and no proxy worker is configured.
 */
export async function downloadVideoViaAppSession(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress?: (ratio: number | null) => void
): Promise<string> {
  if (typeof File?.downloadFileAsync !== 'function' || !Paths?.cache) {
    throw new Error('expo-file-system File.downloadFileAsync unavailable');
  }
  const dir = new Directory(Paths.cache, 'video-fallback');
  dir.create({ intermediates: true, idempotent: true });

  const cleanExtMatch = url.split('?')[0].match(/\.(mp4|m4v|mov)(?:$)/i);
  const ext = cleanExtMatch ? `.${cleanExtMatch[1].toLowerCase()}` : '.mp4';
  const target = new File(dir, `v_${hashVideoCacheKey(url)}${ext}`);

  if (target.exists && target.size > 0) {
    return target.uri;
  }

  // Keep bounded cache size (max 8 fallback videos)
  try {
    const entries = dir.list();
    if (entries.length >= 8) {
      for (const entry of entries.slice(0, entries.length - 7)) {
        try {
          entry.delete();
        } catch {}
      }
    }
  } catch {}

  const downloaded = await File.downloadFileAsync(url, target, {
    headers,
    idempotent: true,
    signal,
    onProgress: onProgress
      ? ({ bytesWritten, totalBytes }) => {
          onProgress(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null);
        }
      : undefined,
  });
  return downloaded.uri;
}
