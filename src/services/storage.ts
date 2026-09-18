import AsyncStorage from '@react-native-async-storage/async-storage';
import { BooruPost } from '../types/booru';
import { DEFAULT_SOURCE } from './sources';

export type ImageQuality = 'preview' | 'auto' | 'full';

const FAVORITES_KEY = '@booru_favorites_v2';
const HISTORY_KEY = '@booru_search_history_v2';
const SOURCE_KEY = '@booru_active_source_v2';
const FAVORITE_TAGS_KEY = '@booru_favorite_tags_v2';
const BLACKLISTED_TAGS_KEY = '@booru_blacklisted_tags_v2';
const IMAGE_QUALITY_KEY = '@booru_image_quality_v2';
const RECENT_VIEWS_KEY = '@booru_recent_views_v2';

let cachedRecentViews: BooruPost[] | null = null;

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
  async getFavorites(): Promise<BooruPost[]> {
    try {
      const data = await AsyncStorage.getItem(FAVORITES_KEY);
      return data ? JSON.parse(data) : [];
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
      return data ? JSON.parse(data) : [];
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
      return data ? JSON.parse(data) : [];
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
      return data ? JSON.parse(data) : [];
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

  async getProxyConfig(): Promise<{ enabled: boolean; workerUrl: string }> {
    try {
      const data = await AsyncStorage.getItem('@booru_proxy_config_v2');
      return data ? JSON.parse(data) : { enabled: false, workerUrl: '' };
    } catch {
      return { enabled: false, workerUrl: '' };
    }
  },

  async getGelbooruAuth(): Promise<{ userId: string; apiKey: string }> {
    try {
      const data = await AsyncStorage.getItem('@booru_gelbooru_auth_v1');
      return data ? JSON.parse(data) : { userId: '', apiKey: '' };
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
        cachedRecentViews = data ? JSON.parse(data) : [];
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
        cachedRecentViews = data ? JSON.parse(data) : [];
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
      const recent = cachedRecentViews || [];
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
};
