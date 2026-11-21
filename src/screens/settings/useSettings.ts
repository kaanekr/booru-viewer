import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useFocusEffect, StackActions } from '@react-navigation/native';
import type { BooruSource } from '../../types/booru';
import {
  DEFAULT_CACHE_LIMIT_MB,
  MAX_CACHE_LIMIT_MB,
  MIN_CACHE_LIMIT_MB,
  StorageService,
  ImageQuality,
} from '../../services/storage';
import { proxyService } from '../../services/proxyService';
import { BackupService } from '../../services/backupService';
import { SecurityService, BiometryType } from '../../services/securityService';
import { testProxyConnection, ConnectionResult } from '../../services/networkDiagnostics';
import { setGridPreviewsEnabled } from '../../utils/gridPreviews';
import { clearCachedPosts } from '../../navigation/postsCache';
import { navigationRef } from '../../navigation/rootNavigation';
import { clearListCache, enforceListCacheLimit, getListCacheStats } from '../../utils/listCache';
import { clearVideoCache, enforceVideoCacheLimit, getVideoCacheStats } from '../../utils/videoFallbackCache';
import { clearResolveCaches } from '../../utils/media';
import type { PasscodeModalMode } from '../../components/PasscodeModal';

interface Credentials { userId: string; apiKey: string }
const EMPTY_AUTH: Credentials = { userId: '', apiKey: '' };

export function useSettings(onSelectSource: (source: BooruSource) => void | Promise<void>) {
  const [loading, setLoading] = useState(true);
  const [imageQuality, setImageQuality] = useState<ImageQuality>('auto');
  const [gridPreviews, setGridPreviews] = useState(true);
  const [blacklistedTags, setBlacklistedTags] = useState<string[]>([]);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [workerUrl, setWorkerUrl] = useState('');
  const [savedWorkerUrl, setSavedWorkerUrl] = useState('');
  const [gelbooruAuth, setGelbooruAuth] = useState<Credentials>(EMPTY_AUTH);
  const [rule34Auth, setRule34Auth] = useState<Credentials>(EMPTY_AUTH);
  const [savedAuth, setSavedAuth] = useState({ gelbooru: EMPTY_AUTH, rule34: EMPTY_AUTH });
  const [busy, setBusy] = useState<string | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [connectionResults, setConnectionResults] = useState<ConnectionResult[]>([]);
  const [passcodeEnabled, setPasscodeEnabled] = useState(false);
  const [useBiometrics, setUseBiometrics] = useState(true);
  const [biometryType, setBiometryType] = useState<BiometryType | null>(null);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [passcodeModalVisible, setPasscodeModalVisible] = useState(false);
  const [passcodeModalMode, setPasscodeModalMode] = useState<PasscodeModalMode>('setup');
  const [cacheLimitMb, setCacheLimitMb] = useState<number>(DEFAULT_CACHE_LIMIT_MB);
  const [cacheLimitInput, setCacheLimitInput] = useState<string>(String(DEFAULT_CACHE_LIMIT_MB));
  const [cacheStats, setCacheStats] = useState({ videoBytes: 0, videoFiles: 0, listBytes: 0, listEntries: 0 });

  const refreshCacheStats = useCallback(() => {
    const video = typeof getVideoCacheStats === 'function' ? getVideoCacheStats() : { bytes: 0, files: 0 };
    const list = typeof getListCacheStats === 'function' ? getListCacheStats() : { bytes: 0, entries: 0 };
    setCacheStats({
      videoBytes: video.bytes,
      videoFiles: video.files,
      listBytes: list.bytes,
      listEntries: list.entries,
    });
  }, []);

  const refreshSecurity = useCallback(async () => {
    const [config, bio] = await Promise.all([SecurityService.getConfig(), SecurityService.getBiometricStatus()]);
    setPasscodeEnabled(config.enabled && !!config.passcodeHash);
    setUseBiometrics(config.useBiometrics);
    setBiometryType(bio.biometryType);
    setHasBiometrics(bio.hasHardware && bio.isEnrolled);
  }, []);

  useEffect(() => {
    let alive = true;
    const loadLimit = typeof StorageService.getCacheLimitMb === 'function'
      ? StorageService.getCacheLimitMb()
      : Promise.resolve(DEFAULT_CACHE_LIMIT_MB);
    Promise.all([StorageService.getProxyConfig(), StorageService.getImageQuality(), StorageService.getGridPreviews(),
      StorageService.getGelbooruAuth(), StorageService.getRule34Auth(), loadLimit]).then(([proxy, quality, previews, gelbooru, rule34, limitMb]) => {
      if (!alive) return;
      setProxyEnabled(proxy.enabled); setWorkerUrl(proxy.workerUrl); setSavedWorkerUrl(proxy.workerUrl);
      proxyService.setConfig(proxy.enabled, proxy.workerUrl);
      setImageQuality(quality); setGridPreviews(previews); setGridPreviewsEnabled(previews);
      setGelbooruAuth(gelbooru); setRule34Auth(rule34); setSavedAuth({ gelbooru, rule34 });
      setCacheLimitMb(limitMb); setCacheLimitInput(String(limitMb));
      refreshCacheStats();
    }).catch(() => Alert.alert('Settings unavailable', 'Could not load your preferences. Please reopen Settings.'))
      .finally(() => { if (alive) setLoading(false); });
    refreshSecurity().catch(() => {});
    return () => { alive = false; };
  }, [refreshSecurity, refreshCacheStats]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    StorageService.getBlacklistedTags().then((tags) => {
      if (!alive) return;
      setBlacklistedTags((prev) =>
        prev.length === tags.length && prev.every((tag, idx) => tag === tags[idx]) ? prev : tags
      );
    });
    refreshCacheStats();
    return () => { alive = false; };
  }, [refreshCacheStats]));

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try { await action(); } catch (error: any) {
      Alert.alert('Could not save changes', error?.message || 'Please try again.');
    } finally { setBusy(null); }
  };

  const changeSource = async (source: BooruSource) => run('source', async () => {
    Haptics.selectionAsync();
    await onSelectSource(source);
    // Do not leave stacked viewers/players alive after changing their source.
    if (navigationRef.isReady() && navigationRef.getState()?.routes.length > 1) navigationRef.dispatch(StackActions.popToTop());
  });

  const saveAuth = async (id: 'gelbooru' | 'rule34') => {
    const draft = id === 'rule34' ? rule34Auth : gelbooruAuth;
    const auth = { userId: draft.userId.trim(), apiKey: draft.apiKey.trim() };
    if (!/^\d+$/.test(auth.userId) || !auth.apiKey) {
      Alert.alert('Missing Info', `Enter your ${id === 'rule34' ? 'Rule34' : 'Gelbooru'} user_id (numbers only) and api_key. Each source needs its own key.`);
      return;
    }
    await run('auth', async () => {
      if (id === 'rule34') await StorageService.setRule34Auth(auth);
      else await StorageService.setGelbooruAuth(auth);
      setSavedAuth((previous) => ({ ...previous, [id]: auth }));
      (id === 'rule34' ? setRule34Auth : setGelbooruAuth)(auth);
      Haptics.selectionAsync();
    });
  };
  const clearAuth = async (id: 'gelbooru' | 'rule34') => run('auth', async () => {
    if (id === 'rule34') await StorageService.setRule34Auth(EMPTY_AUTH);
    else await StorageService.setGelbooruAuth(EMPTY_AUTH);
    (id === 'rule34' ? setRule34Auth : setGelbooruAuth)(EMPTY_AUTH);
    setSavedAuth((previous) => ({ ...previous, [id]: EMPTY_AUTH }));
  });

  const saveWorker = async () => {
    const cleaned = workerUrl.trim().replace(/\/$/, '');
    try {
      const url = new URL(cleaned);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      Alert.alert('Invalid Worker URL', 'Use an HTTPS Worker URL without a query, fragment or embedded credentials.');
      return;
    }
    await run('worker', async () => {
      await StorageService.setProxyConfig({ enabled: proxyEnabled, workerUrl: cleaned });
      proxyService.setConfig(proxyEnabled, cleaned); setWorkerUrl(cleaned); setSavedWorkerUrl(cleaned); setConnectionResults([]);
    });
  };
  const toggleProxy = async (enabled: boolean) => {
    if (!savedWorkerUrl) { Alert.alert('Worker URL required', 'Save your Cloudflare Worker URL before enabling the relay.'); return; }
    await run('proxy', async () => {
      await StorageService.setProxyConfig({ enabled, workerUrl: savedWorkerUrl });
      proxyService.setConfig(enabled, savedWorkerUrl); setProxyEnabled(enabled);
    });
  };
  const removeWorker = async () => run('worker', async () => {
    await StorageService.setProxyConfig({ enabled: false, workerUrl: '' });
    proxyService.setConfig(false, ''); setWorkerUrl(''); setSavedWorkerUrl(''); setProxyEnabled(false); setConnectionResults([]);
  });
  const testConnection = async () => {
    if (!savedWorkerUrl || workerUrl.trim().replace(/\/$/, '') !== savedWorkerUrl) {
      Alert.alert('Save the Worker URL', 'Save your current Worker URL before testing.'); return;
    }
    setIsTestingProxy(true); setConnectionResults([]);
    try { setConnectionResults(await testProxyConnection(savedWorkerUrl)); }
    catch { Alert.alert('Connection test failed', 'Please try again.'); }
    finally { setIsTestingProxy(false); }
  };

  const changeCacheLimit = async (mb: number) => run('cacheLimit', async () => {
    const saved = await StorageService.setCacheLimitMb(mb);
    setCacheLimitMb(saved);
    setCacheLimitInput(String(saved));
    await Promise.all([
      typeof enforceVideoCacheLimit === 'function' ? enforceVideoCacheLimit(saved) : Promise.resolve(),
      typeof enforceListCacheLimit === 'function' ? enforceListCacheLimit(saved) : Promise.resolve(),
    ]);
    refreshCacheStats();
    Haptics.selectionAsync();
  });

  const saveCustomCacheLimit = async () => {
    const trimmed = cacheLimitInput.trim();
    const parsed = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isFinite(parsed) || parsed < MIN_CACHE_LIMIT_MB || parsed > MAX_CACHE_LIMIT_MB) {
      Alert.alert('Invalid cache size', `Enter a size between ${MIN_CACHE_LIMIT_MB} and ${MAX_CACHE_LIMIT_MB} MB.`);
      return;
    }
    await changeCacheLimit(parsed);
  };

  const confirm = (title: string, description: string, action: () => Promise<void>) => Alert.alert(title, description,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => run('clear', action) }]);

  return {
    loading, busy, imageQuality, gridPreviews, blacklistedTags, proxyEnabled, workerUrl, savedWorkerUrl, setWorkerUrl,
    gelbooruAuth, rule34Auth, setGelbooruAuth, setRule34Auth, savedAuth, saveAuth, clearAuth, changeSource,
    saveWorker, removeWorker, toggleProxy, testConnection, isTestingProxy, connectionResults,
    passcodeEnabled, useBiometrics, biometryType, hasBiometrics, passcodeModalVisible, passcodeModalMode, refreshSecurity,
    cacheLimitMb, cacheLimitInput, setCacheLimitInput, cacheStats, refreshCacheStats, changeCacheLimit, saveCustomCacheLimit,
    closePasscode: () => setPasscodeModalVisible(false),
    openPasscode: (mode: PasscodeModalMode) => { setPasscodeModalMode(mode); setPasscodeModalVisible(true); },
    changeQuality: (quality: ImageQuality) => run('quality', async () => { await StorageService.setImageQuality(quality); setImageQuality(quality); Haptics.selectionAsync(); }),
    togglePreviews: (value: boolean) => run('previews', async () => { await StorageService.setGridPreviews(value); setGridPreviews(value); setGridPreviewsEnabled(value); }),
    toggleBiometrics: (value: boolean) => run('biometrics', async () => { await SecurityService.setUseBiometrics(value); setUseBiometrics(value); }),
    removeTag: (tag: string) => run('tag', async () => { await StorageService.removeBlacklistedTag(tag); setBlacklistedTags((tags) => tags.filter((item) => item !== tag)); }),
    clearTags: () => confirm('Clear blocked tags?', 'Posts with these tags will no longer be hidden.', async () => { await StorageService.saveAllBlacklistedTags([]); setBlacklistedTags([]); }),
    clearHistory: () => confirm('Clear search history?', 'Your favorites and blocked tags will be kept.', async () => { await StorageService.clearSearchHistory(); Alert.alert('History cleared'); }),
    clearImageCache: () => confirm('Clear image cache?', 'Downloaded thumbnails and full images will be removed. Your favorites and settings will be kept.', async () => {
      await Image.clearDiskCache(); await Image.clearMemoryCache(); Alert.alert('Image cache cleared');
    }),
    clearVideoCache: () => confirm('Clear video cache?', 'Locally buffered videos will be removed. Your favorites and settings will be kept.', async () => {
      if (typeof clearVideoCache === 'function') await clearVideoCache();
      refreshCacheStats();
      Alert.alert('Video cache cleared');
    }),
    clearApiCache: () => confirm('Clear list & API cache?', 'Cached feeds, search pages and resolved links will be removed.', async () => {
      clearCachedPosts();
      if (typeof clearListCache === 'function') await clearListCache();
      if (typeof clearResolveCaches === 'function') clearResolveCaches();
      refreshCacheStats();
      Alert.alert('List & API cache cleared');
    }),
    clearCache: () => confirm('Clear media cache?', 'Downloaded thumbnails, cached videos and temporary post data will be removed. Your favorites and settings will be kept.', async () => {
      clearCachedPosts();
      if (typeof clearListCache === 'function') await clearListCache();
      if (typeof clearResolveCaches === 'function') clearResolveCaches();
      if (typeof clearVideoCache === 'function') await clearVideoCache();
      await Image.clearDiskCache(); await Image.clearMemoryCache();
      refreshCacheStats();
      Alert.alert('Cache cleared');
    }),
    importBackup: () => run('import', async () => {
      const result = await BackupService.pickAndImportFile();
      if (result) Alert.alert('Backup imported', `${result.favoritesImported.toLocaleString()} new favorites · ${result.tagsImported} tags · ${result.historyImported} searches\n${result.totalFavorites.toLocaleString()} total favorites`);
    }),
    exportBackup: () => run('export', async () => { await BackupService.exportBackup(); }),
  };
}
