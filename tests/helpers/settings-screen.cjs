const path = require('node:path');
const React = require('react');
const { createLoader } = require('./load-typescript.cjs');

exports.setupSettings = function setupSettings({ saved = { userId: '', apiKey: '' }, failWrite = false, proxy = { enabled: false, workerUrl: '' }, cacheLimitMb = 512 } = {}) {
  const writes = [], alerts = [], proxyWrites = [], selections = [], previewWrites = [], cacheLimitWrites = [], cacheClears = [];
  const sources = [
    { id: 'rule34', name: 'Rule34.xxx', baseUrl: 'https://api.rule34.xxx', type: 'gelbooru', description: 'Illustration board' },
    { id: 'gelbooru', name: 'Gelbooru', baseUrl: 'https://gelbooru.com', type: 'gelbooru', description: 'Illustrations' },
    { id: 'redgifs', name: 'RedGifs', baseUrl: 'https://api.redgifs.com', type: 'redgifs', description: 'Videos' },
    { id: 'nhentai', name: 'nhentai', baseUrl: 'https://nhentai.net', type: 'nhentai', description: 'Manga' },
    { id: 'sexcom', name: 'Sex.com', baseUrl: 'https://sex.com', hidden: true },
  ];
  const service = {
    getProxyConfig: async () => proxy,
    setProxyConfig: async (config) => { if (failWrite) throw new Error('disk full'); proxyWrites.push(config); },
    getImageQuality: async () => 'auto', getGridPreviews: async () => true,
    setImageQuality: async () => {}, setGridPreviews: async (value) => previewWrites.push(value),
    getCacheLimitMb: async () => cacheLimitMb,
    setCacheLimitMb: async (mb) => { if (failWrite) throw new Error('disk full'); cacheLimitMb = mb; cacheLimitWrites.push(mb); return mb; },
    getBlacklistedTags: async () => [],
    getGelbooruAuth: async () => ({ userId: '', apiKey: '' }), setGelbooruAuth: async () => {},
    getRule34Auth: async () => saved,
    setRule34Auth: async (auth) => { if (failWrite) throw new Error('disk full'); writes.push(auth); },
  };
  const storageExports = {
    StorageService: service,
    DEFAULT_CACHE_LIMIT_MB: 512,
    MIN_CACHE_LIMIT_MB: 50,
    CACHE_LIMIT_PRESETS_MB: [128, 256, 512, 1024, 2048],
  };
  const security = { SecurityService: {
    getConfig: async () => ({ enabled: false, useBiometrics: true }),
    getBiometricStatus: async () => ({ hasHardware: false, isEnrolled: false }),
  } };
  const proxyMock = { proxyService: { setConfig() {} } };
  const mocks = {
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'ScrollView', 'Switch', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])),
      StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => alerts.push(args) },
      Platform: { OS: 'ios' }, Linking: { openURL: async () => {} },
      BackHandler: { addEventListener: (_event, callback) => { mocks.hardwareBack = callback; return { remove() { mocks.hardwareBack = null; } }; } },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    'expo-haptics': { selectionAsync() {}, impactAsync() {}, ImpactFeedbackStyle: {} },
    'expo-image': { Image: { clearDiskCache: async () => { cacheClears.push('image-disk'); }, clearMemoryCache: async () => { cacheClears.push('image-mem'); } } },
    'expo-file-system': {},
    '../services/sources': { AVAILABLE_SOURCES: sources },
    '../services/storage': storageExports,
    '../../services/storage': storageExports,
    '../../utils/gridPreviews': { setGridPreviewsEnabled() {} },
    '../../utils/listCache': {
      clearListCache: async () => { cacheClears.push('list'); },
      enforceListCacheLimit: async () => {},
      getListCacheStats: () => ({ bytes: 2048, entries: 3 }),
    },
    '../../utils/videoFallbackCache': {
      clearVideoCache: async () => { cacheClears.push('video'); },
      enforceVideoCacheLimit: async () => {},
      getVideoCacheStats: () => ({ bytes: 10 * 1024 * 1024, files: 2 }),
    },
    '../../utils/media': { clearResolveCaches: () => { cacheClears.push('resolve'); } },
    '../../services/proxyService': proxyMock,
    '../../services/backupService': {},
    '../../services/securityService': security,
    '../../services/networkDiagnostics': { testProxyConnection: async () => [] },
    '../components/PasscodeModal': { PasscodeModal: 'PasscodeModal' },
    '../components/SiteLoginModal': { SiteLoginModal: 'SiteLoginModal' },
    '../../navigation/postsCache': { clearCachedPosts: () => { cacheClears.push('posts'); } },
    '../../navigation/rootNavigation': { navigationRef: { isReady: () => false } },
    '../context/SourceContext': { useSource: () => {
      const [activeSource, setSource] = React.useState(sources[0]);
      return { activeSource, selectSource: async (source) => { selections.push(source.id); setSource(source); } };
    } },
    '@react-navigation/native': { useFocusEffect: (callback) => React.useEffect(callback, [callback]) },
  };
  const load = createLoader(mocks);
  return { Screen: load(path.resolve(__dirname, '../../src/screens/SettingsScreen.tsx')).SettingsScreen,
    writes, alerts, proxyWrites, selections, previewWrites, cacheLimitWrites, cacheClears, sources, back: () => mocks.hardwareBack?.() };
};
