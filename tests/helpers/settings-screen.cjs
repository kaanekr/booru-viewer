const path = require('node:path');
const React = require('react');
const { createLoader } = require('./load-typescript.cjs');

exports.setupSettings = function setupSettings({ saved = { userId: '', apiKey: '' }, failWrite = false, proxy = { enabled: false, workerUrl: '' } } = {}) {
  const writes = [], alerts = [], proxyWrites = [], selections = [], previewWrites = [];
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
    getBlacklistedTags: async () => [],
    getGelbooruAuth: async () => ({ userId: '', apiKey: '' }), setGelbooruAuth: async () => {},
    getRule34Auth: async () => saved,
    setRule34Auth: async (auth) => { if (failWrite) throw new Error('disk full'); writes.push(auth); },
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
    'expo-image': { Image: 'Image' },
    '../services/sources': { AVAILABLE_SOURCES: sources },
    '../../services/storage': { StorageService: service },
    '../../utils/gridPreviews': { setGridPreviewsEnabled() {} },
    '../../services/proxyService': proxyMock,
    '../../services/backupService': {},
    '../../services/securityService': security,
    '../../services/networkDiagnostics': { testProxyConnection: async () => [] },
    '../components/PasscodeModal': { PasscodeModal: 'PasscodeModal' },
    '../../navigation/postsCache': {},
    '../../navigation/rootNavigation': { navigationRef: { isReady: () => false } },
    '../context/SourceContext': { useSource: () => {
      const [activeSource, setSource] = React.useState(sources[0]);
      return { activeSource, selectSource: async (source) => { selections.push(source.id); setSource(source); } };
    } },
    '@react-navigation/native': { useFocusEffect: (callback) => React.useEffect(callback, [callback]) },
  };
  const load = createLoader(mocks);
  return { Screen: load(path.resolve(__dirname, '../../src/screens/SettingsScreen.tsx')).SettingsScreen,
    writes, alerts, proxyWrites, selections, previewWrites, sources, back: () => mocks.hardwareBack?.() };
};
