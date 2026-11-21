import AsyncStorage from '@react-native-async-storage/async-storage';
import { BooruPost, HentaiHavenFeedSection, SortOption, TimeRangeOption } from '../types/booru';
import { DEFAULT_SOURCE } from './sources';
import { getPostKey } from '../utils/postIdentity';

export type ImageQuality = 'preview' | 'auto' | 'full';

/** Explore order. The source capability table normalizes unsupported saved presets. */
export interface FeedOrder {
  sortBy: SortOption;
  timeRange: TimeRangeOption;
  /** HentaiHaven Explore section (ignored on other sources) */
  hentaiHavenSection?: HentaiHavenFeedSection;
}

const FAVORITES_KEY = '@booru_favorites_v2';
const HISTORY_KEY = '@booru_search_history_v2';
const SOURCE_KEY = '@booru_active_source_v2';
const FAVORITE_TAGS_KEY = '@booru_favorite_tags_v2';
const BLACKLISTED_TAGS_KEY = '@booru_blacklisted_tags_v2';
const IMAGE_QUALITY_KEY = '@booru_image_quality_v2';
const GRID_PREVIEWS_KEY = '@booru_grid_previews_v2';
const RECENT_VIEWS_KEY = '@booru_recent_views_v2';
const FEED_ORDER_KEY = '@booru_feed_order_v2';
const HH_LAST_EPISODES_KEY = '@booru_hh_last_episodes_v1';
const CACHE_LIMIT_MB_KEY = '@booru_cache_limit_mb_v1';

export const DEFAULT_CACHE_LIMIT_MB = 512;
export const MIN_CACHE_LIMIT_MB = 50;
export const MAX_CACHE_LIMIT_MB = 4096;
export const CACHE_LIMIT_PRESETS_MB = [128, 256, 512, 1024, 2048] as const;

export function clampCacheLimitMb(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CACHE_LIMIT_MB;
  return Math.min(MAX_CACHE_LIMIT_MB, Math.max(MIN_CACHE_LIMIT_MB, Math.round(value)));
}

const VALID_SORT: SortOption[] = ['default', 'id', 'score', 'rating', 'user', 'height', 'width'];
const VALID_RANGE: TimeRangeOption[] = ['all', '1d', '1w', '1m', '1y'];
const VALID_HH_SECTION: HentaiHavenFeedSection[] = [
  'latest',
  'trending',
  'episodes',
  'yuri',
  'ecchi',
  'incest',
  'tentacle',
  'uncensored',
];

let cachedRecentViews: BooruPost[] | null = null;
let cachedFavorites: BooruPost[] | null = null;
let cachedFavoriteKeys: Set<string> | null = null;
let cachedBlacklistedTags: string[] | null = null;
let cachedCacheLimitMb: number | null = null;

function setFavoritesMemoryCache(items: BooruPost[]): void {
  cachedFavorites = items;
  cachedFavoriteKeys = new Set(items.map(getPostKey));
}

// Serialize each read-modify-write, not just setItem. A failed write must not
// poison later operations, and a reader must see earlier queued mutations.
const pendingWrites = new Map<string, Promise<void>>();
function queueWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pendingWrites.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(() => {}, () => {});
  pendingWrites.set(key, settled);
  void settled.then(() => {
    if (pendingWrites.get(key) === settled) pendingWrites.delete(key);
  });
  return result;
}

async function readArray(key: string): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Stored list is invalid; existing data has been preserved.');
  return value;
}

function updateList<T>(
  key: string,
  decode: (value: unknown) => T[],
  update: (items: T[]) => T[],
  onCommit?: (next: T[]) => void
): Promise<T[]> {
  return queueWrite(key, async () => {
    const current = decode(await readArray(key));
    const next = update(current);
    if (next !== current) await AsyncStorage.setItem(key, JSON.stringify(next));
    onCommit?.(next);
    return next;
  });
}

function uniquePosts(posts: BooruPost[]): BooruPost[] {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const key = getPostKey(post);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Shape guards so corrupt AsyncStorage content cannot poison the whole app:
 * fall back to safe defaults when parsed values have unexpected types.
 */
function asPostArray(v: unknown): BooruPost[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (p): p is BooruPost => !!p && typeof p === 'object' && typeof (p as any).id === 'string'
  );
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is string => typeof t === 'string');
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export const StorageService = {
  async getImageQuality(): Promise<ImageQuality> {
    try {
      const data = await AsyncStorage.getItem(IMAGE_QUALITY_KEY);
      if (!data) return 'auto';
      const parsed = JSON.parse(data);
      if (parsed === 'preview' || parsed === 'auto' || parsed === 'full') {
        return parsed;
      }
      return 'auto';
    } catch {
      return 'auto';
    }
  },

  async setImageQuality(quality: ImageQuality): Promise<void> {
    try {
      await AsyncStorage.setItem(IMAGE_QUALITY_KEY, JSON.stringify(quality));
    } catch (e) {
      console.warn('Error saving image quality:', e);
    }
  },

  /**
   * Grid video previews (auto-playing card covers).
   * When off, cards show static covers and no player is created.
   * Default on.
   */
  async getGridPreviews(): Promise<boolean> {
    try {
      const data = await AsyncStorage.getItem(GRID_PREVIEWS_KEY);
      if (data == null) return true;
      return JSON.parse(data) !== false;
    } catch {
      return true;
    }
  },

  async setGridPreviews(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(GRID_PREVIEWS_KEY, JSON.stringify(enabled));
    } catch (e) {
      console.warn('Error saving grid previews:', e);
    }
  },

  async getCacheLimitMb(): Promise<number> {
    if (cachedCacheLimitMb !== null) return cachedCacheLimitMb;
    try {
      const data = await AsyncStorage.getItem(CACHE_LIMIT_MB_KEY);
      if (data == null) {
        cachedCacheLimitMb = DEFAULT_CACHE_LIMIT_MB;
        return DEFAULT_CACHE_LIMIT_MB;
      }
      const parsed = JSON.parse(data);
      const limit = typeof parsed === 'number' ? clampCacheLimitMb(parsed) : DEFAULT_CACHE_LIMIT_MB;
      cachedCacheLimitMb = limit;
      return limit;
    } catch {
      return DEFAULT_CACHE_LIMIT_MB;
    }
  },

  async setCacheLimitMb(mb: number): Promise<number> {
    const clamped = clampCacheLimitMb(mb);
    await AsyncStorage.setItem(CACHE_LIMIT_MB_KEY, JSON.stringify(clamped));
    cachedCacheLimitMb = clamped;
    return clamped;
  },

  async getFavorites(): Promise<BooruPost[]> {
    try {
      await pendingWrites.get(FAVORITES_KEY);
      if (cachedFavorites !== null) return [...cachedFavorites];
      const data = await AsyncStorage.getItem(FAVORITES_KEY);
      const parsed = data ? asPostArray(JSON.parse(data)) : [];
      setFavoritesMemoryCache(parsed);
      return [...parsed];
    } catch {
      return [];
    }
  },

  async isFavorite(post: Pick<BooruPost, 'sourceId' | 'id'>): Promise<boolean> {
    try {
      await pendingWrites.get(FAVORITES_KEY);
      if (cachedFavoriteKeys === null) {
        await this.getFavorites();
      }
      return cachedFavoriteKeys ? cachedFavoriteKeys.has(getPostKey(post)) : false;
    } catch {
      return false;
    }
  },

  async toggleFavorite(post: BooruPost): Promise<boolean> {
    let isFavorite = false;
    await this.updateFavorites((favs) => {
      const key = getPostKey(post);
      isFavorite = !favs.some((p) => getPostKey(p) === key);
      return isFavorite ? [post, ...favs] : favs.filter((p) => getPostKey(p) !== key);
    });
    return isFavorite;
  },

  /** Also used by backup repair/import so a stale snapshot cannot erase a toggle. */
  updateFavorites(update: (items: BooruPost[]) => BooruPost[]): Promise<BooruPost[]> {
    return updateList(FAVORITES_KEY, asPostArray, update, setFavoritesMemoryCache);
  },

  updateFavoriteTags(update: (tags: string[]) => string[]): Promise<string[]> {
    return updateList(FAVORITE_TAGS_KEY, asStringArray, update);
  },

  updateSearchHistory(update: (history: string[]) => string[]): Promise<string[]> {
    return updateList(HISTORY_KEY, asStringArray, update);
  },

  updateBlacklistedTags(update: (tags: string[]) => string[]): Promise<string[]> {
    return updateList(BLACKLISTED_TAGS_KEY, asStringArray, update, (next) => {
      cachedBlacklistedTags = next;
    });
  },

  async getSearchHistory(): Promise<string[]> {
    try {
      await pendingWrites.get(HISTORY_KEY);
      const data = await AsyncStorage.getItem(HISTORY_KEY);
      return data ? asStringArray(JSON.parse(data)) : [];
    } catch {
      return [];
    }
  },

  async addSearchHistory(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!trimmed) return;
      await this.updateSearchHistory((history) =>
        [trimmed, ...history.filter((t) => t.toLowerCase() !== trimmed)].slice(0, 30)
      );
    } catch (e) {
      console.warn('Error saving search history:', e);
    }
  },

  async clearSearchHistory(): Promise<void> {
    try {
      await queueWrite(HISTORY_KEY, () => AsyncStorage.removeItem(HISTORY_KEY));
    } catch (e) {
      console.warn('Error clearing search history:', e);
    }
  },

  /* FAVORITE TAGS (Tag Favorileri) */
  async getFavoriteTags(): Promise<string[]> {
    try {
      await pendingWrites.get(FAVORITE_TAGS_KEY);
      const data = await AsyncStorage.getItem(FAVORITE_TAGS_KEY);
      return data ? asStringArray(JSON.parse(data)) : [];
    } catch {
      return [];
    }
  },

  async isFavoriteTag(tag: string): Promise<boolean> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      const tags = await this.getFavoriteTags();
      return tags.includes(trimmed);
    } catch {
      return false;
    }
  },

  async toggleFavoriteTag(tag: string): Promise<boolean> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!trimmed) return false;
      let added = false;
      await this.updateFavoriteTags((tags) => {
        added = !tags.includes(trimmed);
        return added ? [trimmed, ...tags] : tags.filter((t) => t !== trimmed);
      });
      return added;
    } catch {
      return false;
    }
  },

  async addFavoriteTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!trimmed) return;
      await this.updateFavoriteTags((tags) => tags.includes(trimmed) ? tags : [trimmed, ...tags]);
    } catch (e) {
      console.warn('Error adding favorite tag:', e);
    }
  },

  async removeFavoriteTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      await this.updateFavoriteTags((tags) => tags.filter((t) => t !== trimmed));
    } catch (e) {
      console.warn('Error removing favorite tag:', e);
    }
  },

  /* BLACKLISTED TAGS (Kara Liste) */
  async getBlacklistedTags(): Promise<string[]> {
    try {
      await pendingWrites.get(BLACKLISTED_TAGS_KEY);
      if (cachedBlacklistedTags !== null) return [...cachedBlacklistedTags];
      const data = await AsyncStorage.getItem(BLACKLISTED_TAGS_KEY);
      const parsed = data ? asStringArray(JSON.parse(data)) : [];
      cachedBlacklistedTags = parsed;
      return [...parsed];
    } catch {
      return [];
    }
  },

  async isBlacklistedTag(tag: string): Promise<boolean> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
      const tags = await this.getBlacklistedTags();
      return tags.includes(trimmed);
    } catch {
      return false;
    }
  },

  async toggleBlacklistedTag(tag: string): Promise<boolean> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
      if (!trimmed) return false;
      let added = false;
      await this.updateBlacklistedTags((tags) => {
        added = !tags.includes(trimmed);
        return added ? [trimmed, ...tags] : tags.filter((t) => t !== trimmed);
      });
      return added;
    } catch {
      return false;
    }
  },

  async addBlacklistedTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
      if (!trimmed) return;
      await this.updateBlacklistedTags((tags) => tags.includes(trimmed) ? tags : [trimmed, ...tags]);
    } catch (e) {
      console.warn('Error adding blacklisted tag:', e);
    }
  },

  async removeBlacklistedTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
      await this.updateBlacklistedTags((tags) => tags.filter((t) => t !== trimmed));
    } catch (e) {
      console.warn('Error removing blacklisted tag:', e);
    }
  },

  async clearBlacklistedTags(): Promise<void> {
    try {
      await queueWrite(BLACKLISTED_TAGS_KEY, async () => {
        await AsyncStorage.removeItem(BLACKLISTED_TAGS_KEY);
        cachedBlacklistedTags = [];
      });
    } catch (e) {
      console.warn('Error clearing blacklisted tags:', e);
    }
  },

  async getActiveSourceId(): Promise<string> {
    try {
      const id = await AsyncStorage.getItem(SOURCE_KEY);
      return id || DEFAULT_SOURCE.id;
    } catch {
      return DEFAULT_SOURCE.id;
    }
  },

  async setActiveSourceId(sourceId: string): Promise<void> {
    try {
      await AsyncStorage.setItem(SOURCE_KEY, sourceId);
    } catch (e) {
      console.warn('Error saving active source:', e);
    }
  },

  /** Explore order: returns null when no saved preference (source default). */
  async getFeedOrder(): Promise<FeedOrder | null> {
    try {
      const data = await AsyncStorage.getItem(FEED_ORDER_KEY);
      if (!data) return null;
      const parsed: any = JSON.parse(data);
      if (!VALID_SORT.includes(parsed?.sortBy) || !VALID_RANGE.includes(parsed?.timeRange)) {
        return null;
      }
      const order: FeedOrder = { sortBy: parsed.sortBy, timeRange: parsed.timeRange };
      if (VALID_HH_SECTION.includes(parsed?.hentaiHavenSection)) {
        order.hentaiHavenSection = parsed.hentaiHavenSection;
      }
      return order;
    } catch {
      return null;
    }
  },

  async setFeedOrder(order: FeedOrder): Promise<void> {
    try {
      await AsyncStorage.setItem(FEED_ORDER_KEY, JSON.stringify(order));
    } catch (e) {
      console.warn('Error saving feed order:', e);
    }
  },

  async getProxyConfig(): Promise<{ enabled: boolean; workerUrl: string }> {
    try {
      const data = await AsyncStorage.getItem('@booru_proxy_config_v2');
      if (!data) return { enabled: false, workerUrl: '' };
      const parsed: any = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object') return { enabled: false, workerUrl: '' };
      return { enabled: parsed.enabled === true, workerUrl: asString(parsed.workerUrl) };
    } catch {
      return { enabled: false, workerUrl: '' };
    }
  },

  async getGelbooruAuth(): Promise<{ userId: string; apiKey: string }> {
    try {
      const data = await AsyncStorage.getItem('@booru_gelbooru_auth_v1');
      if (!data) return { userId: '', apiKey: '' };
      const parsed: any = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object') return { userId: '', apiKey: '' };
      return { userId: asString(parsed.userId), apiKey: asString(parsed.apiKey) };
    } catch {
      return { userId: '', apiKey: '' };
    }
  },

  async setGelbooruAuth(auth: { userId: string; apiKey: string }): Promise<void> {
    try {
      await AsyncStorage.setItem('@booru_gelbooru_auth_v1', JSON.stringify(auth));
    } catch (e) {
      console.warn('Error saving gelbooru auth:', e);
      throw e;
    }
  },

  async getRule34Auth(): Promise<{ userId: string; apiKey: string }> {
    try {
      const data = await AsyncStorage.getItem('@booru_rule34_auth_v1');
      const parsed = data ? JSON.parse(data) : null;
      return { userId: asString(parsed?.userId), apiKey: asString(parsed?.apiKey) };
    } catch {
      return { userId: '', apiKey: '' };
    }
  },

  async setRule34Auth(auth: { userId: string; apiKey: string }): Promise<void> {
    await AsyncStorage.setItem('@booru_rule34_auth_v1', JSON.stringify({
      userId: auth.userId.trim(),
      apiKey: auth.apiKey.trim(),
    }));
  },

  async saveAllFavorites(favorites: BooruPost[]): Promise<void> {
    const deduped = uniquePosts(favorites);
    await queueWrite(FAVORITES_KEY, async () => {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(deduped));
      setFavoritesMemoryCache(deduped);
    });
  },

  async saveAllRecentViews(recent: BooruPost[]): Promise<void> {
    try {
      await queueWrite(RECENT_VIEWS_KEY, async () => {
        const sliced = uniquePosts(recent).slice(0, 500);
        await AsyncStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(sliced));
        cachedRecentViews = sliced;
      });
    } catch (e) {
      console.warn('Error saving all recent views:', e);
    }
  },

  async saveAllFavoriteTags(tags: string[]): Promise<void> {
    try {
      await queueWrite(FAVORITE_TAGS_KEY, () => AsyncStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(tags)));
    } catch (e) {
      console.warn('Error saving all favorite tags:', e);
    }
  },

  async saveAllSearchHistory(history: string[]): Promise<void> {
    try {
      await queueWrite(HISTORY_KEY, () => AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history)));
    } catch (e) {
      console.warn('Error saving all search history:', e);
    }
  },

  async saveAllBlacklistedTags(tags: string[]): Promise<void> {
    try {
      await queueWrite(BLACKLISTED_TAGS_KEY, async () => {
        await AsyncStorage.setItem(BLACKLISTED_TAGS_KEY, JSON.stringify(tags));
        cachedBlacklistedTags = [...tags];
      });
    } catch (e) {
      console.warn('Error saving all blacklisted tags:', e);
    }
  },

  async setProxyConfig(config: { enabled: boolean; workerUrl: string }): Promise<void> {
    try {
      await AsyncStorage.setItem('@booru_proxy_config_v2', JSON.stringify(config));
    } catch (e) {
      console.warn('Error saving proxy config:', e);
      throw e;
    }
  },

  /* RECENT VIEWS */
  async mergeRecentViews(posts: BooruPost[]): Promise<void> {
    await queueWrite(RECENT_VIEWS_KEY, async () => {
      const recent = cachedRecentViews ?? asPostArray(await readArray(RECENT_VIEWS_KEY));
      const next = uniquePosts([...recent, ...posts]).slice(0, 500);
      await AsyncStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(next));
      cachedRecentViews = next;
    });
  },

  async getRecentViews(limit?: number, offset?: number): Promise<BooruPost[]> {
    try {
      return await queueWrite(RECENT_VIEWS_KEY, async () => {
        if (cachedRecentViews === null) cachedRecentViews = asPostArray(await readArray(RECENT_VIEWS_KEY));
        if (limit !== undefined) {
          const start = offset || 0;
          return cachedRecentViews.slice(start, start + limit);
        }
        return [...cachedRecentViews];
      });
    } catch {
      return [];
    }
  },

  async addRecentView(post: BooruPost): Promise<void> {
    try {
      if (!post || !post.id) return;
      await queueWrite(RECENT_VIEWS_KEY, async () => {
        const recent = cachedRecentViews ?? asPostArray(await readArray(RECENT_VIEWS_KEY));
        // Refocusing the same viewer does not change history or its metadata.
        if (recent[0] === post) return;
        const key = getPostKey(post);
        const filtered = recent.filter((p) => getPostKey(p) !== key);
        const updated = [post, ...filtered].slice(0, 500);
        await AsyncStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(updated));
        cachedRecentViews = updated;
      });
    } catch (e) {
      console.warn('Error saving recent view:', e);
    }
  },

  async clearRecentViews(): Promise<void> {
    try {
      await queueWrite(RECENT_VIEWS_KEY, async () => {
        await AsyncStorage.removeItem(RECENT_VIEWS_KEY);
        cachedRecentViews = [];
      });
    } catch (e) {
      console.warn('Error clearing recent views:', e);
    }
  },

  /* HENTAIHAVEN LAST WATCHED EPISODE */
  async getLastWatchedEpisode(seriesId: string): Promise<number | null> {
    try {
      if (!seriesId) return null;
      await pendingWrites.get(HH_LAST_EPISODES_KEY);
      const data = await AsyncStorage.getItem(HH_LAST_EPISODES_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      const ep = parsed?.[seriesId];
      return typeof ep === 'number' && Number.isFinite(ep) ? ep : null;
    } catch {
      return null;
    }
  },

  async setLastWatchedEpisode(seriesId: string, episode: number): Promise<void> {
    try {
      if (!seriesId || typeof episode !== 'number' || !Number.isFinite(episode)) return;
      await queueWrite(HH_LAST_EPISODES_KEY, async () => {
        const data = await AsyncStorage.getItem(HH_LAST_EPISODES_KEY);
        const map = data ? JSON.parse(data) : {};
        map[seriesId] = episode;
        await AsyncStorage.setItem(HH_LAST_EPISODES_KEY, JSON.stringify(map));
      });
    } catch (e) {
      console.warn('Error saving last watched episode:', e);
    }
  },
};
