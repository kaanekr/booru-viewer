import { Directory, File, Paths } from 'expo-file-system';
import { DEFAULT_CACHE_LIMIT_MB, StorageService } from '../services/storage';

interface VideoIndexRecord {
  lastAccess: number;
  size: number;
}

type VideoIndexMap = Record<string, VideoIndexRecord>;

function hashVideoCacheKey(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function hasDiskFs(): boolean {
  return (
    typeof Directory === 'function' &&
    typeof File === 'function' &&
    Boolean(Paths?.cache)
  );
}

function getVideoDir(): Directory | null {
  if (!hasDiskFs()) return null;
  try {
    const dir = new Directory(Paths.cache, 'video-fallback');
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null;
  }
}

function readIndex(dir: Directory): VideoIndexMap {
  try {
    const idxFile = new File(dir, 'index.json');
    if (!idxFile.exists || typeof idxFile.textSync !== 'function') return {};
    const parsed = JSON.parse(idxFile.textSync());
    return parsed && typeof parsed === 'object' ? (parsed as VideoIndexMap) : {};
  } catch {
    return {};
  }
}

async function writeIndex(dir: Directory, index: VideoIndexMap): Promise<void> {
  try {
    const idxFile = new File(dir, 'index.json');
    if (typeof idxFile.write === 'function') {
      await idxFile.write(JSON.stringify(index));
    }
  } catch {}
}

export function getVideoBudgetBytes(limitMb: number): number {
  const safeMb = Number.isFinite(limitMb) && limitMb > 0 ? limitMb : DEFAULT_CACHE_LIMIT_MB;
  // Allocate 60% of the user's manual cache budget (min 50 MB) to local video cache
  const videoMb = Math.max(50, Math.round(safeMb * 0.6));
  return videoMb * 1024 * 1024;
}

export async function enforceVideoCacheLimit(limitMb: number, protectedFilename?: string): Promise<void> {
  await syncNativeVideoCacheSize(limitMb);
  const dir = getVideoDir();
  if (!dir) return;

  try {
    const budgetBytes = getVideoBudgetBytes(limitMb);
    const index = readIndex(dir);
    const rawEntries = dir.list();

    let totalBytes = 0;
    const tracked: { entry: File; name: string; size: number; lastAccess: number }[] = [];

    for (const item of rawEntries) {
      const name = (item as any).name as string | undefined;
      if (!name || name === 'index.json' || name === NATIVE_TRACKED_FILE) continue;
      const size = (item as any).size || 0;
      if (size <= 0 || name.endsWith('.tmp')) {
        try { item.delete(); } catch {}
        delete index[name];
        continue;
      }
      totalBytes += size;
      tracked.push({
        entry: item as File,
        name,
        size,
        lastAccess: index[name]?.lastAccess ?? 0,
      });
    }

    if (totalBytes > budgetBytes) {
      tracked.sort((a, b) => a.lastAccess - b.lastAccess);
      for (const item of tracked) {
        if (totalBytes <= budgetBytes) break;
        if (protectedFilename && item.name === protectedFilename) continue;
        try {
          item.entry.delete();
        } catch {}
        delete index[item.name];
        totalBytes -= item.size;
      }
    }

    const liveNames = new Set(tracked.map((t) => t.name).filter((n) => index[n]));
    for (const k of Object.keys(index)) {
      if (!liveNames.has(k)) delete index[k];
    }
    await writeIndex(dir, index);
  } catch {}
}

type ExpoVideoCacheApi = {
  setVideoCacheSizeAsync?: (sizeBytes: number) => Promise<void>;
  clearVideoCacheAsync?: () => Promise<void>;
  getCurrentVideoCacheSize?: () => number;
};

function getExpoVideoCacheApi(): ExpoVideoCacheApi | null {
  try {
    // Lazy require keeps pure-Node tests without expo-video mocks working cleanly.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-video') as ExpoVideoCacheApi;
  } catch {
    return null;
  }
}

/**
 * Returns true when a video URL is safe to pass `useCaching: true` to expo-video.
 * Per Expo SDK 58 docs, iOS AVPlayer cannot cache HLS (.m3u8) streams, and local
 * file:// URIs are already on disk.
 */
export function canUseExpoVideoCache(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  let candidate = trimmed;
  try {
    const parsed = new URL(trimmed);
    const wrapped = parsed.searchParams.get('url');
    if (wrapped && /^https?:\/\//i.test(wrapped)) {
      candidate = wrapped;
    }
  } catch {
    // fall through with trimmed URL
  }

  const lower = candidate.toLowerCase();
  if (/\.m3u8(?:$|[?#&])|\.mpd(?:$|[?#&])|\/hls\/|[?&](?:format|type)=hls(?:$|&)/i.test(lower)) {
    return false;
  }
  return true;
}

export async function syncNativeVideoCacheSize(limitMb?: number): Promise<void> {
  const api = getExpoVideoCacheApi();
  if (typeof api?.setVideoCacheSizeAsync !== 'function') return;
  try {
    const effectiveMb =
      typeof limitMb === 'number'
        ? limitMb
        : typeof StorageService?.getCacheLimitMb === 'function'
          ? await StorageService.getCacheLimitMb()
          : DEFAULT_CACHE_LIMIT_MB;
    await api.setVideoCacheSizeAsync(getVideoBudgetBytes(effectiveMb));
  } catch {
    // expo-video throws if a VideoPlayer instance is currently active; ignore safely.
  }
}

const NATIVE_TRACKED_FILE = 'native-tracked.json';
const MAX_NATIVE_TRACKED_KEYS = 500;
let nativeTrackedKeys: Set<string> | null = null;

function trimNativeTracked(keys: Set<string>): void {
  while (keys.size > MAX_NATIVE_TRACKED_KEYS) {
    const oldest = keys.values().next().value;
    if (oldest === undefined) break;
    keys.delete(oldest);
  }
}

function loadNativeTracked(dir: Directory | null): Set<string> {
  if (nativeTrackedKeys !== null) return nativeTrackedKeys;
  const loaded = new Set<string>();
  if (dir) {
    try {
      const f = new File(dir, NATIVE_TRACKED_FILE);
      if (f.exists) {
        const parsed = JSON.parse(f.textSync());
        if (Array.isArray(parsed)) {
          for (const k of parsed) {
            if (typeof k === 'string' && k) loaded.add(k);
          }
          trimNativeTracked(loaded);
        }
      }
    } catch {}
  }
  nativeTrackedKeys = loaded;
  return loaded;
}

function saveNativeTracked(dir: Directory | null, keys: Set<string>): void {
  if (!dir) return;
  try {
    const f = new File(dir, NATIVE_TRACKED_FILE);
    f.write(JSON.stringify(Array.from(keys)));
  } catch {}
}

function normalizeVideoTrackKey(url: string): string {
  let candidate = url.trim();
  try {
    const parsed = new URL(candidate);
    const wrapped = parsed.searchParams.get('url');
    if (wrapped && /^https?:\/\//i.test(wrapped)) {
      candidate = wrapped;
    }
  } catch {}
  return hashVideoCacheKey(candidate.split('#')[0]);
}

/**
 * Records a video URL that became playable with expo-video `useCaching: true`
 * so Settings can display an accurate cached-video count alongside native bytes.
 */
export function recordCachedVideo(url: string | null | undefined): void {
  if (!url || !canUseExpoVideoCache(url)) return;
  const dir = getVideoDir();
  const keys = loadNativeTracked(dir);
  const key = normalizeVideoTrackKey(url);
  if (keys.has(key)) return;
  keys.add(key);
  trimNativeTracked(keys);
  saveNativeTracked(dir, keys);
}

export function getVideoCacheStats(): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const dir = getVideoDir();
  if (dir) {
    try {
      for (const item of dir.list()) {
        const name = (item as any).name as string | undefined;
        if (!name || name === 'index.json' || name === NATIVE_TRACKED_FILE) continue;
        const size = (item as any).size || 0;
        if (size > 0) {
          bytes += size;
          files++;
        }
      }
    } catch {}
  }

  const api = getExpoVideoCacheApi();
  if (typeof api?.getCurrentVideoCacheSize === 'function') {
    try {
      const nativeBytes = api.getCurrentVideoCacheSize();
      if (typeof nativeBytes === 'number' && Number.isFinite(nativeBytes) && nativeBytes > 0) {
        bytes += nativeBytes;
        const tracked = loadNativeTracked(dir);
        files += tracked.size;
      } else {
        const tracked = loadNativeTracked(dir);
        if (tracked.size > 0) {
          tracked.clear();
          saveNativeTracked(dir, tracked);
        }
      }
    } catch {}
  }

  return { bytes, files };
}

export async function clearVideoCache(): Promise<void> {
  if (nativeTrackedKeys) {
    nativeTrackedKeys.clear();
  } else {
    nativeTrackedKeys = new Set();
  }
  const dir = getVideoDir();
  if (dir) {
    try {
      for (const entry of dir.list()) {
        try {
          entry.delete();
        } catch {}
      }
    } catch {}
  }
  const api = getExpoVideoCacheApi();
  if (typeof api?.clearVideoCacheAsync === 'function') {
    try {
      await api.clearVideoCacheAsync();
    } catch {
      // Ignored if a VideoPlayer instance is still alive.
    }
  }
}

/**
 * Downloads a video through the app process's NSURLSession into Paths.cache
 * when AVFoundation/mediaserverd fails directly (e.g. -1202 on realbooru.com)
 * and no proxy worker is configured. Evicts oldest entries by byte-size LRU
 * according to the user's configured cache size limit.
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
  const dir = getVideoDir();
  if (!dir) {
    throw new Error('Could not initialize video cache directory');
  }

  const cleanExtMatch = url.split('?')[0].match(/\.(mp4|m4v|mov)(?:$)/i);
  const ext = cleanExtMatch ? `.${cleanExtMatch[1].toLowerCase()}` : '.mp4';
  const filename = `v_${hashVideoCacheKey(url)}${ext}`;
  const target = new File(dir, filename);

  if (target.exists && target.size > 0) {
    const index = readIndex(dir);
    index[filename] = { lastAccess: Date.now(), size: target.size };
    void writeIndex(dir, index);
    return target.uri;
  }

  const limitMb =
    typeof StorageService?.getCacheLimitMb === 'function'
      ? await StorageService.getCacheLimitMb().catch(() => DEFAULT_CACHE_LIMIT_MB)
      : DEFAULT_CACHE_LIMIT_MB;
  await enforceVideoCacheLimit(limitMb);

  let downloaded: File;
  try {
    downloaded = await File.downloadFileAsync(url, target, {
      headers,
      idempotent: true,
      signal,
      onProgress: onProgress
        ? ({ bytesWritten, totalBytes }) => {
            onProgress(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null);
          }
        : undefined,
    });
    if (signal?.aborted) {
      const abortErr = new Error('Download aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  } catch (err) {
    try {
      target.delete();
    } catch {}
    throw err;
  }

  const finalSize = downloaded.size || target.size || 0;
  const index = readIndex(dir);
  index[filename] = { lastAccess: Date.now(), size: finalSize };
  await writeIndex(dir, index);
  await enforceVideoCacheLimit(limitMb, filename);

  return downloaded.uri;
}
