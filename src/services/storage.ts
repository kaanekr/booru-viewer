import AsyncStorage from '@react-native-async-storage/async-storage';
import { BooruPost, HentaiHavenFeedSection, SortOption, TimeRangeOption } from '../types/booru';
import { DEFAULT_SOURCE } from './sources';

export type ImageQuality = 'preview' | 'auto' | 'full';

/** Keşfet akışının sıralaması (RedGifs: trend / en yeni / top7 / top28; HentaiHaven: bölüm). */
export interface FeedOrder {
  sortBy: SortOption;
  timeRange: TimeRangeOption;
  /** HentaiHaven Keşfet bölümü (diğer kaynaklarda yoksayılır) */
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
const REDGIFS_TOKEN_KEY = '@booru_redgifs_token_v2';
const HH_LAST_EPISODES_KEY = '@booru_hh_last_episodes_v1';

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

/**
 * Bozuk AsyncStorage içeriği tüm uygulamayı zehirlemesin diye şekil
 * korumaları: parse sonucu beklenen tipte değilse güvenli varsayılan.
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
   * Izgara video önizlemeleri (otomatik oynayan kart kapakları).
   * Kapalıysa kartlar statik kapak gösterir, oyuncu kurulmaz.
   * Varsayılan açık.
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
  async getFavorites(): Promise<BooruPost[]> {
    try {
      const data = await AsyncStorage.getItem(FAVORITES_KEY);
      return data ? asPostArray(JSON.parse(data)) : [];
    } catch {
      return [];
    }
  },

  async isFavorite(postId: string): Promise<boolean> {
    try {
      const favs = await this.getFavorites();
      return favs.some((p) => p.id === postId);
    } catch {
      return false;
    }
  },

  async toggleFavorite(post: BooruPost): Promise<boolean> {
    try {
      const favs = await this.getFavorites();
      const exists = favs.some((p) => p.id === post.id);
      let updated: BooruPost[];
      if (exists) {
        updated = favs.filter((p) => p.id !== post.id);
      } else {
        updated = [post, ...favs];
      }
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
      return !exists;
    } catch {
      return false;
    }
  },

  async getSearchHistory(): Promise<string[]> {
    try {
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
      const history = await this.getSearchHistory();
      const filtered = history.filter((t) => t.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 30);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Error saving search history:', e);
    }
  },

  async clearSearchHistory(): Promise<void> {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
    } catch (e) {
      console.warn('Error clearing search history:', e);
    }
  },

  /* FAVORITE TAGS (Tag Favorileri) */
  async getFavoriteTags(): Promise<string[]> {
    try {
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
      const tags = await this.getFavoriteTags();
      const exists = tags.includes(trimmed);
      let updated: string[];
      if (exists) {
        updated = tags.filter((t) => t !== trimmed);
      } else {
        updated = [trimmed, ...tags];
      }
      await AsyncStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(updated));
      return !exists;
    } catch {
      return false;
    }
  },

  async addFavoriteTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!trimmed) return;
      const tags = await this.getFavoriteTags();
      if (!tags.includes(trimmed)) {
        await AsyncStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify([trimmed, ...tags]));
      }
    } catch (e) {
      console.warn('Error adding favorite tag:', e);
    }
  },

  async removeFavoriteTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, ' ');
      const tags = await this.getFavoriteTags();
      const updated = tags.filter((t) => t !== trimmed);
      await AsyncStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Error removing favorite tag:', e);
    }
  },

  /* BLACKLISTED TAGS (Kara Liste) */
  async getBlacklistedTags(): Promise<string[]> {
    try {
      const data = await AsyncStorage.getItem(BLACKLISTED_TAGS_KEY);
      return data ? asStringArray(JSON.parse(data)) : [];
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
      const tags = await this.getBlacklistedTags();
      const exists = tags.includes(trimmed);
      let updated: string[];
      if (exists) {
        updated = tags.filter((t) => t !== trimmed);
      } else {
        updated = [trimmed, ...tags];
      }
      await AsyncStorage.setItem(BLACKLISTED_TAGS_KEY, JSON.stringify(updated));
      return !exists;
    } catch {
      return false;
    }
  },

  async addBlacklistedTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
      if (!trimmed) return;
      const tags = await this.getBlacklistedTags();
      if (!tags.includes(trimmed)) {
        await AsyncStorage.setItem(BLACKLISTED_TAGS_KEY, JSON.stringify([trimmed, ...tags]));
      }
    } catch (e) {
      console.warn('Error adding blacklisted tag:', e);
    }
  },

  async removeBlacklistedTag(tag: string): Promise<void> {
    try {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '_');
      const tags = await this.getBlacklistedTags();
      const updated = tags.filter((t) => t !== trimmed);
      await AsyncStorage.setItem(BLACKLISTED_TAGS_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Error removing blacklisted tag:', e);
    }
  },

  async clearBlacklistedTags(): Promise<void> {
    try {
      await AsyncStorage.removeItem(BLACKLISTED_TAGS_KEY);
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

  /** Keşfet sırası: null dönerse kayıtlı tercih yok (kaynak varsayılanı). */
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

  /**
   * RedGifs geçici token'ı. Soğuk açılışta auth isteği yapmamak için
   * süre bilgisiyle birlikte saklanır; süresi geçen kayıt kullanılmaz.
   */
  async getRedGifsTokenCache(): Promise<{ token: string; expiry: number } | null> {
    try {
      const data = await AsyncStorage.getItem(REDGIFS_TOKEN_KEY);
      if (!data) return null;
      const parsed: any = JSON.parse(data);
      if (typeof parsed?.token !== 'string' || typeof parsed?.expiry !== 'number') return null;
      if (parsed.expiry <= Date.now()) return null;
      return { token: parsed.token, expiry: parsed.expiry };
    } catch {
      return null;
    }
  },

  async setRedGifsTokenCache(token: string, expiry: number): Promise<void> {
    try {
      await AsyncStorage.setItem(REDGIFS_TOKEN_KEY, JSON.stringify({ token, expiry }));
    } catch (e) {
      console.warn('Error saving redgifs token:', e);
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
    }
  },

  async saveAllFavorites(favorites: BooruPost[]): Promise<void> {
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) {
      console.warn('Error saving all favorites:', e);
    }
  },

  async saveAllRecentViews(recent: BooruPost[]): Promise<void> {
    try {
      const sliced = recent.slice(-500);
      cachedRecentViews = sliced;
      await AsyncStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(sliced));
    } catch (e) {
      console.warn('Error saving all recent views:', e);
    }
  },

  async saveAllFavoriteTags(tags: string[]): Promise<void> {
    try {
      await AsyncStorage.setItem(FAVORITE_TAGS_KEY, JSON.stringify(tags));
    } catch (e) {
      console.warn('Error saving all favorite tags:', e);
    }
  },

  async saveAllSearchHistory(history: string[]): Promise<void> {
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('Error saving all search history:', e);
    }
  },

  async saveAllBlacklistedTags(tags: string[]): Promise<void> {
    try {
      await AsyncStorage.setItem(BLACKLISTED_TAGS_KEY, JSON.stringify(tags));
    } catch (e) {
      console.warn('Error saving all blacklisted tags:', e);
    }
  },

  async setProxyConfig(config: { enabled: boolean; workerUrl: string }): Promise<void> {
    try {
      await AsyncStorage.setItem('@booru_proxy_config_v2', JSON.stringify(config));
    } catch (e) {
      console.warn('Error saving proxy config:', e);
    }
  },

  /* RECENT VIEWS (Son Görüntülenenler) */
  async getRecentViews(limit?: number, offset?: number): Promise<BooruPost[]> {
    try {
      if (cachedRecentViews === null) {
        const data = await AsyncStorage.getItem(RECENT_VIEWS_KEY);
        cachedRecentViews = data ? asPostArray(JSON.parse(data)) : [];
      }
      if (limit !== undefined) {
        const start = offset || 0;
        return (cachedRecentViews || []).slice(start, start + limit);
      }
      return [...(cachedRecentViews || [])];
    } catch {
      return [];
    }
  },

  async getRecentViewsCount(): Promise<number> {
    try {
      if (cachedRecentViews === null) {
        const data = await AsyncStorage.getItem(RECENT_VIEWS_KEY);
        cachedRecentViews = data ? asPostArray(JSON.parse(data)) : [];
      }
      return (cachedRecentViews || []).length;
    } catch {
      return 0;
    }
  },

  async addRecentView(post: BooruPost): Promise<void> {
    try {
      if (!post || !post.id) return;
      if (cachedRecentViews === null) {
        await this.getRecentViews();
      }
      const recent = asPostArray(cachedRecentViews || []);
      const filtered = recent.filter((p) => p.id !== post.id);
      const updated = [post, ...filtered].slice(0, 500);
      cachedRecentViews = updated;
      await AsyncStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Error saving recent view:', e);
    }
  },

  async clearRecentViews(): Promise<void> {
    try {
      cachedRecentViews = [];
      await AsyncStorage.removeItem(RECENT_VIEWS_KEY);
    } catch (e) {
      console.warn('Error clearing recent views:', e);
    }
  },

  /* HENTAIHAVEN LAST WATCHED EPISODE */
  async getLastWatchedEpisode(seriesId: string): Promise<number | null> {
    try {
      if (!seriesId) return null;
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
      const data = await AsyncStorage.getItem(HH_LAST_EPISODES_KEY);
      const map = data ? JSON.parse(data) : {};
      map[seriesId] = episode;
      await AsyncStorage.setItem(HH_LAST_EPISODES_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('Error saving last watched episode:', e);
    }
  },
};
