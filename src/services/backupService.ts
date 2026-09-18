import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { BooruPost, BooruTagGroups } from '../types/booru';
import { StorageService } from './storage';
import { normalizeBooruMediaUrl } from '../utils/media';
import animeboxesDefaultBackup from '../data/animeboxesBackup.json';

export interface ImportResult {
  favoritesImported: number;
  tagsImported: number;
  historyImported: number;
  totalFavorites: number;
}

export function mapAnimeBoxesFavoriteToBooruPost(f: any): BooruPost {
  let sourceId = 'gelbooru';
  let sourceName = 'Gelbooru';

  if (f.ppostUrl) {
    const lowerUrl = f.ppostUrl.toLowerCase();
    if (lowerUrl.includes('gelbooru.com')) {
      sourceId = 'gelbooru';
      sourceName = 'Gelbooru';
    } else if (lowerUrl.includes('rule34.xxx') || lowerUrl.includes('rule34.us')) {
      sourceId = 'rule34';
      sourceName = 'Rule34.xxx';
    } else if (lowerUrl.includes('danbooru')) {
      sourceId = 'danbooru';
      sourceName = 'Danbooru';
    } else if (lowerUrl.includes('realbooru.com')) {
      sourceId = 'realbooru';
      sourceName = 'Realbooru';
    } else if (lowerUrl.includes('yande.re')) {
      sourceId = 'yandere';
      sourceName = 'Yande.re';
    } else if (lowerUrl.includes('konachan')) {
      sourceId = 'konachan';
      sourceName = 'Konachan';
    } else if (lowerUrl.includes('safebooru')) {
      sourceId = 'safebooru';
      sourceName = 'Safebooru';
    } else if (lowerUrl.includes('cum.st') || lowerUrl.includes('coomer.st')) {
      sourceId = 'cumst';
      sourceName = 'Cum.st';
    }
  } else if (f.preview?.url) {
    const lowerPrev = f.preview.url.toLowerCase();
    if (lowerPrev.includes('gelbooru')) {
      sourceId = 'gelbooru';
      sourceName = 'Gelbooru';
    } else if (lowerPrev.includes('rule34')) {
      sourceId = 'rule34';
      sourceName = 'Rule34.xxx';
    } else if (lowerPrev.includes('donmai.us')) {
      sourceId = 'danbooru';
      sourceName = 'Danbooru';
    } else if (lowerPrev.includes('realbooru')) {
      sourceId = 'realbooru';
      sourceName = 'Realbooru';
    } else if (lowerPrev.includes('yande.re')) {
      sourceId = 'yandere';
      sourceName = 'Yande.re';
    } else if (lowerPrev.includes('cum.st')) {
      sourceId = 'cumst';
      sourceName = 'Cum.st';
    }
  }

  const rawTags = (f.tags || '')
    .split(/\s+/)
    .map((t: string) => t.trim().toLowerCase())
    .filter(Boolean);

  const isVideo =
    f.file?.ext === 'mp4' ||
    f.file?.ext === 'webm' ||
    (f.file?.url && (f.file.url.endsWith('.mp4') || f.file.url.endsWith('.webm'))) ||
    rawTags.includes('video') ||
    rawTags.includes('mp4') ||
    rawTags.includes('webm') ||
    rawTags.includes('animated');

  const rawPreview = f.preview?.url || f.sample?.url || f.file?.url || '';
  const rawSample = f.sample?.url || f.jpeg?.url || f.file?.url || rawPreview;
  const rawOriginal = f.file?.url || f.jpeg?.url || rawSample;

  const previewUrl = normalizeBooruMediaUrl(rawPreview);
  const sampleUrl = normalizeBooruMediaUrl(rawSample);
  const originalUrl = normalizeBooruMediaUrl(rawOriginal);

  const width = f.file?.width || f.jpeg?.width || f.sample?.width || f.preview?.width || 800;
  const height = f.file?.height || f.jpeg?.height || f.sample?.height || f.preview?.height || 1000;
  const aspectRatio = width > 0 && height > 0 ? width / height : 0.75;

  let rating: 's' | 'q' | 'e' | 'g' = 's';
  if (f.rating === 'explicit' || f.rating === 'e') rating = 'e';
  else if (f.rating === 'questionable' || f.rating === 'q' || f.rating === 'sensitive') rating = 'q';
  else rating = 's';

  const rawId = f.ppostId || f.md5 || Math.random().toString(36).substring(2, 10);
  const id = `${sourceId}_${rawId}`;

  const tags: BooruTagGroups = {
    artist: [],
    character: [],
    copyright: [],
    general: rawTags,
    meta: isVideo ? ['video'] : [],
  };

  let detectedExt = f.file?.ext || f.jpeg?.ext;
  if (!detectedExt && f.file?.url) {
    const extMatch = f.file.url.split('?')[0].match(/\.([a-z0-9]+)$/i);
    if (extMatch) detectedExt = extMatch[1].toLowerCase();
  }
  if (!detectedExt && isVideo) {
    detectedExt = sourceId === 'realbooru' ? 'webm' : 'mp4';
  }
  const fileExt = detectedExt || (isVideo ? 'mp4' : 'jpg');

  return {
    id,
    sourceId,
    sourceName,
    previewUrl,
    sampleUrl,
    originalUrl,
    width,
    height,
    aspectRatio,
    rating,
    score: Number(f.score) || 0,
    favCount: 0,
    tags,
    allTags: rawTags,
    sourceLink: f.source || f.ppostUrl || undefined,
    fileExt,
    createdAt: f.dateAdded || new Date().toISOString(),
  };
}

function inferSourceFromHaystack(haystack: string): { id: string; name: string } | null {
  if (!haystack) return null;
  if (haystack.includes('safebooru')) return { id: 'safebooru', name: 'Safebooru' };
  if (haystack.includes('gelbooru')) return { id: 'gelbooru', name: 'Gelbooru' };
  if (haystack.includes('realbooru')) return { id: 'realbooru', name: 'Realbooru' };
  if (haystack.includes('rule34')) return { id: 'rule34', name: 'Rule34.xxx' };
  if (haystack.includes('danbooru') || haystack.includes('donmai')) return { id: 'danbooru', name: 'Danbooru' };
  if (haystack.includes('yande.re')) return { id: 'yandere', name: 'Yande.re' };
  if (haystack.includes('konachan')) return { id: 'konachan', name: 'Konachan' };
  if (haystack.includes('cum.st') || haystack.includes('coomer')) return { id: 'cumst', name: 'Cum.st' };
  return null;
}

export const BackupService = {
  /**
   * Parse AnimeBoxes backup and extract posts, starred tags, search history, banned tags
   */
  parseAnimeBoxesBackup(backupData: any): {
    posts: BooruPost[];
    starredTags: string[];
    searchHistory: string[];
    bannedTags: string[];
  } {
    const rawFavs = Array.isArray(backupData?.favorites) ? backupData.favorites : [];
    const posts = rawFavs.map(mapAnimeBoxesFavoriteToBooruPost);

    const rawHistory = Array.isArray(backupData?.searchHistory) ? backupData.searchHistory : [];
    const starredTags = rawHistory
      .filter((h: any) => h && h.starred && h.searchText)
      .map((h: any) => h.searchText.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);

    const searchHistory = rawHistory
      .filter((h: any) => h && h.searchText)
      .map((h: any) => h.searchText.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);

    const bannedTags = Array.isArray(backupData?.bannedTags)
      ? backupData.bannedTags
          .map((t: any) => (typeof t === 'string' ? t : t?.name || ''))
          .filter(Boolean)
      : [];

    return {
      posts,
      starredTags: Array.from(new Set<string>(starredTags)),
      searchHistory: Array.from(new Set<string>(searchHistory)),
      bannedTags: Array.from(new Set<string>(bannedTags)),
    };
  },

  /**
   * Import parsed AnimeBoxes data into the app's AsyncStorage
   */
  async importBackupData(backupData: any): Promise<ImportResult> {
    const { posts, starredTags, searchHistory, bannedTags } = this.parseAnimeBoxesBackup(backupData);

    // 0. Merge Recent Views (favoriler tarihe göre en yeniden eskiye: dateAdded desc)
    try {
      const sortedByDate = [...posts].sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      });
      const currentRecent = await StorageService.getRecentViews();
      const existingRecentIds = new Set(currentRecent.map((p) => p.id));
      const freshViews = sortedByDate.filter((p) => !existingRecentIds.has(p.id));
      if (freshViews.length > 0) {
        const mergedRecent = [...currentRecent, ...freshViews].slice(-500);
        await StorageService.saveAllRecentViews(mergedRecent);
      }
    } catch (e) {
      console.warn('[BackupService] Recent views merge error:', e);
    }

    // 1. Merge Favorites
    const currentFavs = await StorageService.getFavorites();
    const existingIds = new Set(currentFavs.map((p) => p.id));
    const existingUrls = new Set(currentFavs.map((p) => p.originalUrl || p.sampleUrl || p.previewUrl));

    const newPostsToAdd: BooruPost[] = [];
    for (const p of posts) {
      if (!existingIds.has(p.id) && !existingUrls.has(p.originalUrl)) {
        newPostsToAdd.push(p);
        existingIds.add(p.id);
        existingUrls.add(p.originalUrl);
      }
    }

    const mergedFavorites = [...newPostsToAdd, ...currentFavs];
    await StorageService.saveAllFavorites(mergedFavorites);

    // 2. Merge Starred / Favorite Tags
    const currentFavTags = await StorageService.getFavoriteTags();
    const mergedFavTags = Array.from(new Set([...starredTags, ...currentFavTags]));
    await StorageService.saveAllFavoriteTags(mergedFavTags);

    // 3. Merge Search History
    const currentHistory = await StorageService.getSearchHistory();
    const mergedHistory = Array.from(new Set([...searchHistory, ...currentHistory])).slice(0, 100);
    await StorageService.saveAllSearchHistory(mergedHistory);

    // 4. Merge Banned Tags (if any)
    if (bannedTags.length > 0) {
      const currentBanned = await StorageService.getBlacklistedTags();
      const mergedBanned = Array.from(new Set([...bannedTags, ...currentBanned]));
      await StorageService.saveAllBlacklistedTags(mergedBanned);
    }

    return {
      favoritesImported: newPostsToAdd.length,
      tagsImported: starredTags.length,
      historyImported: searchHistory.length,
      totalFavorites: mergedFavorites.length,
    };
  },

  /**
   * Directly import the bundled '15 Sep 2026.abbj' backup
   */
  async importBundledBackup(): Promise<ImportResult> {
    return await this.importBackupData(animeboxesDefaultBackup);
  },

  /**
   * Pick an .abbj or .json backup file from document picker and import it
   */
  async pickAndImportFile(): Promise<ImportResult | null> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*', 'application/json', 'text/plain'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || !result.assets[0]) {
        return null;
      }

      const fileAsset = result.assets[0];
      const pickedFile = new File(fileAsset.uri);
      const fileContent = await pickedFile.text();

      const parsedJson = JSON.parse(fileContent);
      return await this.importBackupData(parsedJson);
    } catch (e) {
      console.warn('[BackupService] File import error:', e);
      throw e;
    }
  },

  /**
   * Export all favorites and tags to a shareable JSON file
   */
  async exportBackup(): Promise<boolean> {
    try {
      const favorites = await StorageService.getFavorites();
      const favoriteTags = await StorageService.getFavoriteTags();
      const searchHistory = await StorageService.getSearchHistory();
      const blacklistedTags = await StorageService.getBlacklistedTags();
      const recentViews = await StorageService.getRecentViews();

      const backupObj = {
        creatorName: 'BooruViewer',
        backupVersion: '1.0',
        exportDate: new Date().toISOString(),
        favoritesCount: favorites.length,
        favorites,
        favoriteTags,
        searchHistory,
        blacklistedTags,
        recentViews,
      };

      const jsonStr = JSON.stringify(backupObj, null, 2);
      const filename = `booru_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const exportFile = new File(Paths.cache, filename);

      try {
        exportFile.create({ overwrite: true });
      } catch {
        // Ignored if already exists
      }
      exportFile.write(jsonStr);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(exportFile.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Yedeği Paylaş / Kaydet',
          UTI: 'public.json',
        });
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[BackupService] Export error:', e);
      throw e;
    }
  },

  /**
   * Scans and updates existing stored favorites in AsyncStorage:
   * - Normalizes old/broken Gelbooru, Rule34, Danbooru URLs
   * - Ensures HTTPS
   * - Normalizes multi-tag cluster favorite tags with spaces
   */
  async repairAndNormalizeStoredFavorites(): Promise<number> {
    try {
      const currentFavs = await StorageService.getFavorites();

      let changedCount = 0;
      if (currentFavs && currentFavs.length > 0) {
        const repairedFavs = currentFavs.map((post) => {
          const prevUrl = normalizeBooruMediaUrl(post.previewUrl);
          const sampUrl = normalizeBooruMediaUrl(post.sampleUrl);
          const origUrl = normalizeBooruMediaUrl(post.originalUrl);

          // Eski kayıtlarda eksik sourceId/sourceName'i URL'lerden geri çıkar
          let nextSourceId = post.sourceId;
          let nextSourceName = post.sourceName;
          if (!nextSourceId || !nextSourceName) {
            const haystack = `${prevUrl} ${sampUrl} ${origUrl} ${post.sourceLink || ''} ${post.id || ''}`.toLowerCase();
            const inferred = inferSourceFromHaystack(haystack);
            if (inferred) {
              if (!nextSourceId) nextSourceId = inferred.id;
              if (!nextSourceName) nextSourceName = inferred.name;
            }
          }

          // Realbooru ve diğer booru'lardaki .webm kayıtlarının fileExt'ini düzelt ('webm'), URL'leri bozma (.mp4'e çevirme)
          let nextFileExt = post.fileExt;
          const isRealbooru =
            nextSourceId === 'realbooru' ||
            origUrl.includes('realbooru.com') ||
            sampUrl.includes('realbooru.com') ||
            prevUrl.includes('realbooru.com');

          const hasWebmUrl =
            origUrl.split('?')[0].toLowerCase().endsWith('.webm') ||
            sampUrl.split('?')[0].toLowerCase().endsWith('.webm');

          if ((isRealbooru && hasWebmUrl) || (hasWebmUrl && nextFileExt !== 'webm')) {
            nextFileExt = 'webm';
          }

          if (
            prevUrl !== post.previewUrl ||
            sampUrl !== post.sampleUrl ||
            origUrl !== post.originalUrl ||
            nextSourceId !== post.sourceId ||
            nextSourceName !== post.sourceName ||
            nextFileExt !== post.fileExt
          ) {
            changedCount++;
            return {
              ...post,
              previewUrl: prevUrl,
              sampleUrl: sampUrl,
              originalUrl: origUrl,
              sourceId: nextSourceId,
              sourceName: nextSourceName,
              fileExt: nextFileExt,
            };
          }
          return post;
        });

        if (changedCount > 0) {
          await StorageService.saveAllFavorites(repairedFavs);
          console.log(`[BackupService] Successfully repaired ${changedCount} favorites in storage.`);
        }
      }

      // Repair and normalize favorite tags
      const currentTags = await StorageService.getFavoriteTags();
      const STARRED_TAG_REPAIR_MAP: Record<string, string> = {
        'toned_huge_breasts': 'toned huge_breasts',
        'midriff_thick_thighs_microskirt': 'midriff thick_thighs microskirt',
        'midriff_thick_thighs': 'midriff thick_thighs',
        'lifting_person_standing_sex': 'lifting_person standing_sex',
        'huge_breasts_crop_top': 'huge_breasts crop_top',
        'leaning_back_standing_1girls_-furry': 'leaning_back standing 1girls -furry',
        'cupping_hands_tongue_out_uvula': 'cupping_hands tongue_out uvula',
        'garter_belt_skirt_ass_bent_over': 'garter_belt skirt ass bent_over',
        'cosplay_skirt_large_ass': 'cosplay skirt large_ass',
        'x-ray_ahegao_heart_score:>50_sound_effects': 'x-ray ahegao heart score:>50 sound_effects',
        'x-ray_ahegao': 'x-ray ahegao',
        'cupping_hands_tongue_out': 'cupping_hands tongue_out',
        'open_mouth_looking_at_viewer_tongue_solo_tongue_out': 'open_mouth looking_at_viewer tongue solo tongue_out',
        'open_mouth_saliva_looking_at_viewer_tongue_solo_tongue_out': 'open_mouth saliva looking_at_viewer tongue solo tongue_out',
        'arms_up_midriff_midriff_peek': 'arms_up midriff midriff_peek',
        'hu_tao_(genshin_impact)_thick_thighs': 'hu_tao_(genshin_impact) thick_thighs',
      };

      if (currentTags && currentTags.length > 0) {
        let tagRepaired = false;
        const fixedTags = currentTags.map((t) => {
          if (STARRED_TAG_REPAIR_MAP[t]) {
            tagRepaired = true;
            return STARRED_TAG_REPAIR_MAP[t];
          }
          return t;
        });
        if (tagRepaired) {
          await StorageService.saveAllFavoriteTags(Array.from(new Set(fixedTags)));
          console.log('[BackupService] Successfully normalized multi-tag favorite clusters.');
        }
      }

      return changedCount;
    } catch (e) {
      console.warn('[BackupService] repairAndNormalizeStoredFavorites error:', e);
      return 0;
    }
  },
};
