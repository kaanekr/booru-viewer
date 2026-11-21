const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { loadScrollAwayHeader } = require('./helpers/scroll-away-header.cjs');
const { setupSettings } = require('./helpers/settings-screen.cjs');

global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => {
  if (root) await act(() => root.unmount());
  root = undefined;
});

const defaultSource = { id: 'danbooru', name: 'Danbooru', type: 'danbooru', baseUrl: 'https://danbooru.donmai.us' };
const makePost = (id, overrides = {}) => ({
  id: String(id),
  sourceId: 'danbooru',
  sourceName: 'Danbooru',
  previewUrl: `https://img.test/${id}-preview.jpg`,
  sampleUrl: `https://img.test/${id}-sample.jpg`,
  originalUrl: `https://img.test/${id}-orig.jpg`,
  width: 600,
  height: 800,
  aspectRatio: 0.75,
  rating: 's',
  score: 10,
  fileExt: 'jpg',
  allTags: ['sky', 'blue_hair'],
  tags: { general: ['sky', 'blue_hair'], artist: [], character: [], copyright: [], meta: [] },
  ...overrides,
});

// Fix 1: Intermediate ScrollAwayHeader slide frames respect the 80ms grid throttle
test('Fix 1: FeedScreen throttles viewport updates during intermediate ScrollAwayHeader slide frames', async () => {
  const scrollHeader = loadScrollAwayHeader();
  let visibleCalls = 0;
  let mountedCalls = 0;
  let focusedCalls = 0;
  const load = createLoader({
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      StyleSheet: { create: (v) => v },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      ...Object.fromEntries(
        ['ActivityIndicator', 'RefreshControl', 'ScrollView', 'Text', 'TouchableOpacity', 'View'].map((n) => [n, n])
      ),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useNavigation: () => ({ navigate() {} }), useIsFocused: () => true },
    'expo-haptics': { selectionAsync() {}, impactAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': { AlertCircle: 'AlertCircle', Flame: 'Flame', Layers: 'Layers', RefreshCw: 'RefreshCw' },
    '../services/booruApi': {
      booruApi: {
        buildQueryTags: () => '',
        fetchPosts: async () => [makePost('1'), makePost('2')],
        fetchRedGifsTrendingTags: async () => [],
      },
    },
    '../services/storage': { StorageService: { getFavorites: async () => [], getFeedOrder: async () => null, saveFeedOrder: async () => {} } },
    '../utils/listCache': { buildListCacheKey: () => 'k', getListCache: async () => null, setListCache: async () => {} },
    '../components/PostCard': { PostCard: 'PostCard' },
    '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../context/SourceContext': { useSource: () => ({ activeSource: defaultSource }) },
    '../navigation/rootNavigation': { pushViewer() {}, pushSearchDetail() {} },
    '../theme/colors': { Colors: { dark: {} } },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), () => { visibleCalls++; }],
      useFocusedCardIds: () => [new Set(), () => { focusedCalls++; }],
      useMountedIds: () => [null, () => { mountedCalls++; }],
    },
    '../utils/gridPreviewMedia': { getGridPreviewVideoCandidates: () => [], getGridPreviewFrames: () => [] },
    '../utils/imagePrefetch': { prefetchGridImages() {} },
    '../utils/media': { isImageMediaUrl: () => true, prefetchGridImages() {} },
    '../utils/freezeProbe': { updateFreezeProbe() {} },
    '../utils/postIdentity': { getPostKey: (p) => `${p.sourceId}:${p.id}` },
    '../utils/mediaPlayback': { useMediaPlaybackAllowed: () => true },
    '../utils/sourceQuickFilters': {
      getSourceQuickFilters: () => [],
      isFeedQuickFilterActive: () => false,
      normalizeFeedQuickFilter: (_s, o) => o,
    },
    '../utils/scrollAwayHeader': scrollHeader.hook,
    '../components/ScrollAwayHeader': scrollHeader.component,
  });
  const { FeedScreen } = load(path.resolve(__dirname, '../src/screens/FeedScreen.tsx'));
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => {
    root.root.findByProps({ testID: 'scroll-away-header' }).props.onLayout({
      nativeEvent: { layout: { height: 120 } },
    });
  });

  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const move = (y) => act(async () => {
    scroll().props.onScroll({
      nativeEvent: { contentOffset: { y }, layoutMeasurement: { height: 500 }, contentSize: { height: 5000 } },
    });
  });

  await move(0);
  const before = { visibleCalls, mountedCalls, focusedCalls };
  // Simulate 5 rapid 16ms-like scroll ticks while header is mid-slide (occlusion between 1 and 119)
  await move(10);
  await move(20);
  await move(30);
  await move(40);
  await move(50);
  assert.equal(visibleCalls, before.visibleCalls, 'intermediate header slide must not bypass 80ms throttle');
  assert.equal(mountedCalls, before.mountedCalls);
  assert.equal(focusedCalls, before.focusedCalls);

  // Hitting the fully-hidden header edge flushes immediately
  await move(150);
  assert.equal(visibleCalls, before.visibleCalls + 1, 'reaching hidden header edge should flush viewport');
});

// Fix 2: PostCard does not double-render on mount due to failedFrames Set allocation
test('Fix 2: PostCard mounts in a single render without redundant failedFrames reset', async () => {
  let renderCount = 0;
  const load = createLoader({
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      StyleSheet: { create: (v) => v, absoluteFill: {} },
      useWindowDimensions: () => { renderCount++; return { width: 390, height: 844 }; },
      Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
    },
    'expo-image': { Image: 'Image' },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: () => ({ play() {}, pause() {}, release() {} }) },
    expo: { useEventListener() {} },
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } },
    'lucide-react-native': { BookOpen: 'BookOpen', Heart: 'Heart', Play: 'Play', Volume2: 'Volume2' },
    '../theme/colors': { Colors: { dark: {} } },
    '../utils/media': {
      getMediaUrl: (u) => u || '',
      getMediaHeaders: () => ({}),
      getImageCacheKey: (u) => u || '',
      isUnsupportedOnIOS: () => false,
    },
    '../utils/guards': { urlEndsWith: () => false },
    '../services/proxyService': { proxyService: { hasWorker: () => false, forceProxyUrl: (u) => u } },
    '../utils/imageLoadGate': { useLoadGate: () => [true, () => {}] },
    '../utils/freezeProbe': { trackGridPlayer() {}, recordFreezeEvent() {} },
    '../utils/gridPreviews': {
      useGridPreviewsEnabled: () => false,
      markPreviewFailure() {},
      isPreviewBlocked: () => false,
      clearPreviewFailure() {},
    },
    '../utils/gridPreviewMedia': { getGridPreviewVideoCandidates: () => [], getGridPreviewFrames: () => [] },
    '../utils/videoFallbackCache': { canUseExpoVideoCache: () => false, recordCachedVideo() {} },
    '../utils/postIdentity': { getPostKey: (p) => `${p.sourceId}:${p.id}` },
  });
  const { PostCard } = load(path.resolve(__dirname, '../src/components/PostCard.tsx'));
  await act(async () => {
    root = create(React.createElement(PostCard, { post: makePost('1'), onPress() {} }));
  });
  assert.equal(renderCount, 1, 'PostCard should render once on mount');
});

// Fix 3 & Fix 8 (SearchFilterModal): hidden modal gates children/dateSlots, and open modal preserves unsaved edits across parent re-renders
test('Fix 3 & Fix 8: SourceSheet & SearchFilterModal gate hidden children, skip dateSlots when closed, and preserve draft edits while open', async () => {
  let dayCalls = 0;
  let weekCalls = 0;
  let monthCalls = 0;
  const animatedStub = {
    Value: class { constructor(v) { this.v = v; } setValue(v) { this.v = v; } interpolate() { return 1; } },
    View: 'AnimatedView',
    timing: () => ({ start: (cb) => cb?.() }),
  };
  const commonMocks = {
    react: React,
    'react-native': {
      Alert: { alert() {} },
      Animated: animatedStub,
      Platform: { OS: 'ios' },
      StyleSheet: { create: (v) => v },
      ...Object.fromEntries(
        ['KeyboardAvoidingView', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])
      ),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'lucide-react-native': { Settings2: 'Settings2', X: 'X', Search: 'Search', ChevronRight: 'ChevronRight', Check: 'Check' },
    'expo-haptics': { selectionAsync() {}, impactAsync() {}, notificationAsync() {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    '../context/SourceContext': { useSource: () => ({ activeSource: defaultSource, selectSource: async () => {} }) },
    '../services/storage': { StorageService: { getRule34Auth: async () => ({ userId: '', apiKey: '' }) } },
    '../services/booruApi': { booruApi: { searchTags: async () => [] } },
    '../services/nhentai': { nhentaiTagQuery: (t) => t },
    '../services/hentaihavens': { hentaiHavenTagQuery: (t) => t },
    '../utils/leaderboardPeriods': {
      dayDateOptions: () => { dayCalls++; return []; },
      weekDateOptions: () => { weekCalls++; return []; },
      monthDateOptions: () => { monthCalls++; return []; },
      describeAnchor: () => 'Latest',
    },
    './SourceCatalog': { SourceCatalog: 'SourceCatalog', SourceMark: 'SourceMark' },
    './TagChip': { TagChip: 'TagChip' },
    '../theme/colors': { Colors: { dark: { textMuted: '#888' } } },
    '../types/booru': {
      DEFAULT_FILTER_CONFIG: {
        tags: [], rating: 'all', sortBy: 'default', timeRange: 'all',
        includeBlacklisted: false, autocompleteFromServer: true,
        jumpToPage: 1, cumstService: 'all', cumstMediaType: 'all',
      },
    },
  };

  // SourceSheet closed: keeps Modal mounted, omits SourceCatalog & KeyboardAvoidingView
  const { SourceSheet } = createLoader(commonMocks)(path.resolve(__dirname, '../src/components/SourceSheet.tsx'));
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: false, onClose() {} }));
  });
  assert.equal(root.root.findAllByType('Modal').length, 1);
  assert.equal(root.root.findByType('Modal').props.visible, false);
  assert.equal(root.root.findAllByType('SourceCatalog').length, 0);
  await act(() => root.unmount());
  root = undefined;

  // SearchFilterModal closed: keeps Modal mounted, omits KeyboardAvoidingView, never computes dateSlots
  const { SearchFilterModal } = createLoader(commonMocks)(path.resolve(__dirname, '../src/components/SearchFilterModal.tsx'));
  const baseConfig = {
    tags: ['initial'], rating: 'all', sortBy: 'default', timeRange: 'all',
    includeBlacklisted: false, autocompleteFromServer: true,
    jumpToPage: 1, cumstService: 'all', cumstMediaType: 'all',
  };
  const applied = [];
  await act(async () => {
    root = create(React.createElement(SearchFilterModal, {
      visible: false,
      filterConfig: baseConfig,
      activeSource: defaultSource,
      onClose() {},
      onApply: (c) => applied.push(c),
    }));
  });
  assert.equal(root.root.findAllByType('Modal').length, 1);
  assert.equal(root.root.findAllByType('KeyboardAvoidingView').length, 0);
  assert.equal(dayCalls + weekCalls + monthCalls, 0);

  // Open modal, edit tag input, then parent re-renders with a new filterConfig reference while visible=true
  await act(async () => {
    root.update(React.createElement(SearchFilterModal, {
      visible: true,
      filterConfig: baseConfig,
      activeSource: defaultSource,
      onClose() {},
      onApply: (c) => applied.push(c),
    }));
  });
  assert.equal(dayCalls + weekCalls + monthCalls, 0, 'dateSlots should not compute until dateAnchor picker opens');
  const tagInput = root.root.findAllByType('TextInput')[0];
  await act(async () => { tagInput.props.onChangeText('unsaved_tag'); });

  // Parent re-renders with a cloned filterConfig while modal is already open
  await act(async () => {
    root.update(React.createElement(SearchFilterModal, {
      visible: true,
      filterConfig: { ...baseConfig },
      activeSource: defaultSource,
      onClose() {},
      onApply: (c) => applied.push(c),
    }));
  });
  assert.equal(root.root.findAllByType('TextInput')[0].props.value, 'unsaved_tag', 'unsaved edits must survive parent re-render while open');
});

// Fix 4, Fix 6, Fix 7 (SearchScreen): stable TagChip onPress across keystrokes, cancellable onBlur timer, favoriteTags refresh on focus
test('Fix 4, Fix 6, Fix 7: SearchScreen preserves TagChip onPress across keystrokes, cancels stale onBlur timer, and refreshes favoriteTags on focus', async () => {
  let focused = true;
  let favTags = ['alpha'];
  const timeouts = new Map();
  let nextTimerId = 1;
  const load = createLoader({
    react: React,
    'react-native': {
      Keyboard: { dismiss() {} },
      Platform: { OS: 'ios' },
      StyleSheet: { create: (v) => v },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      ...Object.fromEntries(
        ['ActivityIndicator', 'FlatList', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((n) => [n, n])
      ),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useNavigation: () => ({ navigate() {}, setParams() {} }), useIsFocused: () => focused },
    'expo-haptics': { selectionAsync() {}, impactAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': Object.fromEntries(
      ['AlertCircle', 'ArrowLeft', 'Clock', 'Flame', 'Image', 'Layers', 'Pin', 'RefreshCw', 'Search', 'SlidersHorizontal', 'X'].map((n) => [n, n])
    ),
    '../services/booruApi': {
      booruApi: {
        fetchPostsWithFilter: async () => [],
        searchTags: async () => [],
        fetchRedGifsNiches: async () => [],
      },
    },
    '../services/storage': {
      StorageService: {
        getFavorites: async () => [],
        getSearchHistory: async () => ['recent_one'],
        getFavoriteTags: async () => favTags,
        addSearchHistory: async () => {},
        clearSearchHistory: async () => {},
      },
    },
    '../utils/listCache': { buildListCacheKey: () => 'k', getListCache: async () => null, setListCache: async () => {} },
    '../services/nhentai': { nhentaiTagQuery: (t) => t },
    '../services/hentaihavens': { hentaiHavenTagQuery: (t) => t },
    '../components/PostCard': { PostCard: 'PostCard' },
    '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SearchFilterModal': { SearchFilterModal: 'SearchFilterModal' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../context/SourceContext': { useSource: () => ({ activeSource: defaultSource, selectSource: async () => {} }) },
    '../navigation/rootNavigation': { pushViewer() {} },
    '../theme/colors': { Colors: { dark: { textMuted: '#888', primary: '#fff', danger: '#f00' } } },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), () => {}],
      useFocusedCardIds: () => [new Set(), () => {}],
      useMountedIds: () => [null, () => {}],
    },
    '../utils/gridPreviewMedia': { getGridPreviewVideoCandidates: () => [], getGridPreviewFrames: () => [] },
    '../utils/imagePrefetch': { prefetchGridImages() {} },
    '../utils/media': { isImageMediaUrl: () => true, prefetchGridImages() {} },
    '../utils/postIdentity': { getPostKey: (p) => `${p.sourceId}:${p.id}` },
    '../utils/mediaPlayback': { useMediaPlaybackAllowed: () => true },
    '../utils/sourceQuickFilters': {
      applyQuickFilter: (_o, c) => c,
      getSourceQuickFilters: () => [],
      isQuickFilterActive: () => false,
    },
    '../utils/scrollAwayHeader': loadScrollAwayHeader().hook,
    '../components/ScrollAwayHeader': loadScrollAwayHeader().component,
  }, {
    setTimeout: (fn, ms) => { const id = nextTimerId++; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timeouts.delete(id); },
  });

  const { SearchScreen } = load(path.resolve(__dirname, '../src/screens/SearchScreen.tsx'));
  await act(async () => { root = create(React.createElement(SearchScreen)); });

  // Fix 4: TagChip onPress reference stays identical across typing keystrokes
  const beforeOnPress = root.root.findAllByType('TagChip').map((n) => n.props.onPress);
  assert.ok(beforeOnPress.length > 0);
  const input = root.root.findByType('TextInput');
  await act(async () => { input.props.onChangeText('a'); });
  const afterOnPress = root.root.findAllByType('TagChip').map((n) => n.props.onPress);
  assert.equal(afterOnPress.length, beforeOnPress.length);
  for (let i = 0; i < beforeOnPress.length; i++) {
    assert.equal(afterOnPress[i], beforeOnPress[i], `TagChip[${i}] onPress must stay stable across keystrokes`);
  }

  // Fix 6: Re-focusing cancels pending 250ms blur timer
  await act(async () => { input.props.onFocus(); });
  await act(async () => { input.props.onBlur(); });
  const blurTimersBeforeRefocus = [...timeouts.values()].filter((t) => t.ms === 250);
  assert.equal(blurTimersBeforeRefocus.length, 1);
  await act(async () => { input.props.onFocus(); });
  const blurTimersAfterRefocus = [...timeouts.values()].filter((t) => t.ms === 250);
  assert.equal(blurTimersAfterRefocus.length, 0, 're-focusing must clear the pending blur timer');

  // Fix 7: Returning focus refreshes favoriteTags even while isSearchActive stays false
  focused = false;
  await act(async () => { root.update(React.createElement(SearchScreen)); });
  favTags = ['alpha', 'beta_pinned'];
  focused = true;
  await act(async () => { root.update(React.createElement(SearchScreen)); });
  const chipNames = root.root.findAllByType('TagChip').map((n) => n.props.name);
  assert.ok(chipNames.includes('beta_pinned'), 'SearchScreen must refresh favoriteTags on focus');
});

// Fix 5, Fix 7, Fix 8 (FavoritesScreen): preserves post identity on unchanged reload & History screenActive respects effectiveIsActive
test('Fix 5, Fix 7, Fix 8: FavoritesScreen preserves post references on unchanged reload and gates History screenActive on effectiveIsActive', async () => {
  const header = loadScrollAwayHeader();
  const favData = [
    makePost('1', { allTags: ['blue_hair', 'solo'] }),
    makePost('2', { allTags: ['red_eyes'], rating: 'e' }),
  ];
  const historyData = [makePost('99')];
  const load = createLoader({
    react: React,
    'react-native': {
      Alert: { alert() {} },
      Platform: { OS: 'ios' },
      StyleSheet: { create: (v) => v },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      ...Object.fromEntries(
        ['ActivityIndicator', 'FlatList', 'Modal', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((n) => [n, n])
      ),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@react-navigation/native': { useNavigation: () => ({ navigate() {} }), useIsFocused: () => true },
    'expo-haptics': { selectionAsync() {}, impactAsync() {}, notificationAsync() {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    'lucide-react-native': new Proxy({}, { get: (_t, prop) => String(prop) }),
    '../services/storage': {
      StorageService: {
        // Return fresh cloned objects on every call, just like AsyncStorage JSON.parse
        getFavorites: async () => favData.map((p) => ({ ...p, allTags: [...p.allTags] })),
        getFavoriteTags: async () => ['blue_hair'],
        getRecentViews: async () => historyData.map((p) => ({ ...p })),
        clearRecentViews: async () => {},
        removeFavoriteTag: async () => {},
      },
    },
    '../services/backupService': { BackupService: { repairAndNormalizeStoredFavorites: async () => 0 } },
    '../services/booruApi': { AVAILABLE_SOURCES: [defaultSource] },
    '../components/PostCard': { PostCard: 'PostCard' },
    '../components/TagChip': { TagChip: 'TagChip' },
    '../navigation/rootNavigation': { pushViewer() {} },
    '../theme/colors': { Colors: { dark: {} } },
    '../utils/guards': { asStrOr: (v, d) => v || d, lower: (v) => String(v || '').toLowerCase(), onlyStrings: (a) => (Array.isArray(a) ? a : []) },
    '../utils/postIdentity': { getPostKey: (p) => `${p.sourceId}:${p.id}` },
    '../utils/mediaPlayback': { useMediaPlaybackAllowed: () => true },
    '../utils/gridVisibility': { useMountedIds: () => [null, () => {}] },
    '../utils/scrollAwayHeader': header.hook,
    '../components/ScrollAwayHeader': header.component,
  });

  const { FavoritesScreen } = load(path.resolve(__dirname, '../src/screens/FavoritesScreen.tsx'));
  await act(async () => { root = create(React.createElement(FavoritesScreen, { isActive: true })); });
  const initialPosts = root.root.findAllByType('PostCard').map((n) => n.props.post);
  assert.equal(initialPosts.length, 2);

  // Toggle isActive false -> true to trigger focus reload with cloned AsyncStorage objects
  await act(async () => { root.update(React.createElement(FavoritesScreen, { isActive: false })); });
  await act(async () => { root.update(React.createElement(FavoritesScreen, { isActive: true })); });
  const reloadedPosts = root.root.findAllByType('PostCard').map((n) => n.props.post);
  assert.equal(reloadedPosts[0], initialPosts[0], 'unchanged favorites reload must preserve PostCard post identity');
  assert.equal(reloadedPosts[1], initialPosts[1]);

  // Fix 5: text query filters accurately
  const searchInput = root.root.findByType('TextInput');
  await act(async () => { searchInput.props.onChangeText('red_eyes'); });
  assert.equal(root.root.findAllByType('PostCard').length, 1);
  assert.equal(root.root.findByType('PostCard').props.post.id, '2');

  // Fix 8: History renderItem respects effectiveIsActive (false when isActive=false)
  const historyTab = root.root.findAllByType('TouchableOpacity').find((n) =>
    n.findAllByType('Text').some((t) => String(t.props.children).includes('History'))
  );
  await act(async () => { historyTab.props.onPress(); });
  await act(async () => { root.update(React.createElement(FavoritesScreen, { isActive: false })); });
  const historyList = root.root.findByType('FlatList');
  const rendered = historyList.props.renderItem({ item: historyData[0] });
  assert.equal(rendered.props.screenActive, false, 'History PostCard must pause when effectiveIsActive is false');
});

// Fix 8 (SettingsScreen): double-tapping a row pushes only one page
test('Fix 8: SettingsScreen deduplicates double-tapped page navigation so one Back returns home', async () => {
  const { Screen } = setupSettings();
  await act(async () => { root = create(React.createElement(Screen)); });
  const findBtn = (label) =>
    root.root.findAllByType('TouchableOpacity').find((n) => n.props.accessibilityLabel === label);

  // Double-tap Viewing before Back
  const viewingBtn = findBtn('Viewing');
  await act(async () => {
    viewingBtn.props.onPress();
    viewingBtn.props.onPress();
  });
  assert.ok(findBtn('Back to settings'));

  // A single Back press must return to Home (no Back button left)
  await act(async () => { findBtn('Back to settings').props.onPress(); });
  assert.equal(findBtn('Back to settings'), undefined, 'single Back must return to Settings home after double-tap');
});
