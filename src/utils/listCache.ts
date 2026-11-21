import { Directory, File, Paths } from 'expo-file-system';
import type { BooruPost } from '../types/booru';
import { LruCache } from './lruCache';
import { DEFAULT_CACHE_LIMIT_MB, StorageService } from '../services/storage';

export const FEED_LIST_TTL_MS = 10 * 60 * 1000;   // 10 minutes
export const SEARCH_LIST_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_STALE_AGE_MS = 24 * 60 * 60 * 1000;     // 24 hours hard expiry

interface StoredListEntry {
  posts: BooruPost[];
  updatedAt: number;
  ttlMs: number;
}

export interface ListCacheHit {
  posts: BooruPost[];
  stale: boolean;
  updatedAt: number;
}

interface ListIndexRecord {
  lastAccess: number;
  size: number;
}

type ListIndexMap = Record<string, ListIndexRecord>;

const memoryLists = new LruCache<string, StoredListEntry>(40);

function hashKey(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
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

function getListDir(): Directory | null {
  if (!hasDiskFs()) return null;
  try {
    const dir = new Directory(Paths.cache, 'list-cache');
    dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null;
  }
}

function readIndex(dir: Directory): ListIndexMap {
  try {
    const idxFile = new File(dir, 'index.json');
    if (!idxFile.exists) return {};
    const parsed = JSON.parse(idxFile.textSync());
    return parsed && typeof parsed === 'object' ? (parsed as ListIndexMap) : {};
  } catch {
    return {};
  }
}

async function writeIndex(dir: Directory, index: ListIndexMap): Promise<void> {
  try {
    const idxFile = new File(dir, 'index.json');
    await idxFile.write(JSON.stringify(index));
  } catch {}
}

export function getListBudgetBytes(limitMb: number | null): number {
  if (limitMb === null) return Infinity;
  // Allocate 10% of the user's manual cache budget (clamped 8–50 MB) to list JSON
  const listMb = Math.min(50, Math.max(8, Math.round(limitMb * 0.1)));
  return listMb * 1024 * 1024;
}

export function buildListCacheKey(
  scope: 'feed' | 'search',
  sourceId: string,
  queryTags: string,
  filterKey: string,
  page: number = 1
): string {
  return `${scope}|${sourceId}|${queryTags.trim().toLowerCase()}|${filterKey}|p${page}`;
}

export async function getListCache(key: string): Promise<ListCacheHit | null> {
  const now = Date.now();
  const mem = memoryLists.get(key);
  if (mem) {
    if (now - mem.updatedAt > MAX_STALE_AGE_MS) {
      memoryLists.delete(key);
      return null;
    }
    return {
      posts: mem.posts,
      stale: now - mem.updatedAt > mem.ttlMs,
      updatedAt: mem.updatedAt,
    };
  }

  const dir = getListDir();
  if (!dir) return null;

  const filename = `l_${hashKey(key)}.json`;
  try {
    const file = new File(dir, filename);
    if (!file.exists) return null;
    const raw = await file.text();
    const parsed = JSON.parse(raw) as StoredListEntry;
    if (!parsed || !Array.isArray(parsed.posts) || typeof parsed.updatedAt !== 'number') {
      try { file.delete(); } catch {}
      return null;
    }
    if (now - parsed.updatedAt > MAX_STALE_AGE_MS) {
      try { file.delete(); } catch {}
      return null;
    }
    memoryLists.set(key, parsed);
    const index = readIndex(dir);
    index[filename] = { lastAccess: now, size: file.size || raw.length };
    void writeIndex(dir, index);
    return {
      posts: parsed.posts,
      stale: now - parsed.updatedAt > (parsed.ttlMs || FEED_LIST_TTL_MS),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function setListCache(
  key: string,
  posts: BooruPost[],
  ttlMs: number = FEED_LIST_TTL_MS
): Promise<void> {
  if (!Array.isArray(posts) || posts.length === 0) return;
  const entry: StoredListEntry = { posts, updatedAt: Date.now(), ttlMs };
  memoryLists.set(key, entry);

  const dir = getListDir();
  if (!dir) return;

  const filename = `l_${hashKey(key)}.json`;
  try {
    const file = new File(dir, filename);
    const payload = JSON.stringify(entry);
    await file.write(payload);
    const index = readIndex(dir);
    index[filename] = { lastAccess: Date.now(), size: file.size || payload.length };
    await writeIndex(dir, index);

    const limitMb =
      typeof StorageService?.getCacheLimitMb === 'function'
        ? await StorageService.getCacheLimitMb().catch(() => DEFAULT_CACHE_LIMIT_MB)
        : DEFAULT_CACHE_LIMIT_MB;
    await enforceListCacheLimit(limitMb);
  } catch {}
}

export async function enforceListCacheLimit(limitMb: number | null): Promise<void> {
  if (limitMb === null) return;
  const dir = getListDir();
  if (!dir) return;

  try {
    const budgetBytes = getListBudgetBytes(limitMb);
    const index = readIndex(dir);
    const files = dir.list().filter((item): item is File => item instanceof File && item.name !== 'index.json');

    let totalBytes = 0;
    const tracked: { file: File; name: string; size: number; lastAccess: number }[] = [];
    for (const f of files) {
      const size = f.size || 0;
      if (size <= 0) {
        try { f.delete(); } catch {}
        delete index[f.name];
        continue;
      }
      totalBytes += size;
      const rec = index[f.name];
      tracked.push({
        file: f,
        name: f.name,
        size,
        lastAccess: rec?.lastAccess ?? 0,
      });
    }

    if (totalBytes > budgetBytes) {
      tracked.sort((a, b) => a.lastAccess - b.lastAccess);
      for (const item of tracked) {
        if (totalBytes <= budgetBytes) break;
        try {
          item.file.delete();
        } catch {}
        delete index[item.name];
        totalBytes -= item.size;
      }
    }

    // Prune stale index keys
    const liveNames = new Set(tracked.map((t) => t.name).filter((n) => index[n]));
    for (const k of Object.keys(index)) {
      if (!liveNames.has(k)) delete index[k];
    }
    await writeIndex(dir, index);
  } catch {}
}

export function getListCacheStats(): { bytes: number; entries: number } {
  const dir = getListDir();
  if (!dir) return { bytes: 0, entries: memoryLists.size };
  try {
    const files = dir.list().filter((item): item is File => item instanceof File && item.name !== 'index.json');
    let bytes = 0;
    for (const f of files) bytes += f.size || 0;
    return { bytes, entries: files.length };
  } catch {
    return { bytes: 0, entries: memoryLists.size };
  }
}

export async function clearListCache(): Promise<void> {
  memoryLists.clear();
  const dir = getListDir();
  if (!dir) return;
  try {
    for (const entry of dir.list()) {
      try {
        entry.delete();
      } catch {}
    }
  } catch {}
}
