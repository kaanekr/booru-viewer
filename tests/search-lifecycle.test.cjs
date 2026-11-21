const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });
const post = (id) => ({ id, sourceId: 'a', previewUrl: `https://cdn.test/${id}.jpg`, tags: {}, aspectRatio: 1 });

function setup(sourceOverride = {}, apiOverrides = {}) {
  const scrollHeader = require('./helpers/scroll-away-header.cjs').loadScrollAwayHeader();
  const source = { id: 'a', type: 'danbooru', name: 'A', ...sourceOverride };
  const requests = [];
  const viewport = {};
  const navigation = { setParams() {}, navigate() {} };
  const load = createLoader({
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value }, Keyboard: { dismiss() {} },
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'expo-image': { Image: { prefetch: async () => {} } },
    '../services/booruApi': { booruApi: {
      fetchPostsWithFilter: (filter, page, _limit, source) => new Promise((resolve, reject) => requests.push({ filter, page, source, resolve, reject })),
      fetchRedGifsNiches: async () => [],
      fetchSourceTags: async () => [],
      ...apiOverrides,
    } },
    '../services/nhentai': {}, '../services/hentaihavens': {},
    '@react-navigation/native': { useNavigation: () => navigation, useIsFocused: () => true },
    '../services/storage': { StorageService: {
      getFavorites: async () => [], getSearchHistory: async () => [], getFavoriteTags: async () => [], addSearchHistory: async () => {},
    } },
    '../components/PostCard': { PostCard: 'PostCard' }, '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SearchFilterModal': { SearchFilterModal: 'SearchFilterModal' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../navigation/rootNavigation': { pushViewer() {} }, '../theme/colors': { Colors: { dark: {} } },
    '../utils/media': { getMediaUrl: (url) => url, getMediaHeaders: () => ({}), isVideoPost: () => false, isImageMediaUrl: (url) => !/\.(mp4|webm|mov|m4v|m3u8|mpd|zip)(?:\?|$)/i.test(String(url || '')) },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), (_layouts, offset, height) => { viewport.visible = { offset, height }; }],
      useMountedIds: () => [null, () => {}],
      useFocusedCardIds: () => [new Set(), (_layouts, offset, height, playable) => { viewport.focused = { offset, height, playable }; }],
    },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../context/SourceContext': { useSource: () => ({ activeSource: source }) },
    '../utils/scrollAwayHeader': scrollHeader.hook,
    '../components/ScrollAwayHeader': scrollHeader.component,
    '../utils/imagePrefetch': { prefetchGridImages() {} },
    '../utils/listCache': {
      buildListCacheKey: () => 'search-key',
      SEARCH_LIST_TTL_MS: 1800000,
      getListCache: async () => null,
      setListCache: async () => {},
    },
  }, { console: { ...console, warn() {} } });
  return {
    Screen: load(path.resolve(__dirname, '../src/screens/SearchScreen.tsx')).SearchScreen,
    defaults: load(path.resolve(__dirname, '../src/types/booru.ts')).DEFAULT_FILTER_CONFIG,
    requests, viewport, navigation, headerAnimations: scrollHeader.animations,
  };
}
const apply = async (defaults, tag) => act(async () => {
  root.root.findByType('SearchFilterModal').props.onApply({ ...defaults, tags: [tag] });
});
const bottom = () => root.root.findAllByType('ScrollView').find((node) => node.props.onScroll).props.onScroll({
  nativeEvent: { contentOffset: { y: 2000 }, layoutMeasurement: { height: 844 }, contentSize: { height: 2500 } },
});

test('quick filter before the first search actually fetches instead of only lighting the chip', async () => {
  const { Screen, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Weekly Top' }).props.onPress());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].filter.sortBy, 'score');
  assert.equal(requests[0].filter.timeRange, '1w');
  assert.equal(requests[0].page, 1);
});

test('video weekly search chips depend on a keyword and never offer Safe or Points', async () => {
  const { Screen, requests } = setup({ id: 'xvideos', type: 'xvideos' });
  await act(async () => { root = create(React.createElement(Screen)); });
  assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Weekly Top' }).length, 0);
  assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Safe' }).length, 0);
  assert.equal(root.root.findAllByProps({ accessibilityLabel: '50+ Points' }).length, 0);
  const input = root.root.findAllByType('TextInput')[0];
  await act(async () => input.props.onChangeText('cosplay'));
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Weekly Top' }).props.onPress());
  assert.equal(requests.length, 1);
  assert.deepEqual(Array.from(requests[0].filter.tags), ['cosplay']);
  assert.equal(requests[0].filter.timeRange, '1w');
});

test('Explore displays source tags and applies the native query when a tag is tapped', async () => {
  const { Screen, requests } = setup({ id: 'nhentai', type: 'nhentai' }, {
    fetchSourceTags: async () => [{ name: 'Lunar Press', query: 'group:"Lunar Press"', category: 'artist', postCount: 5 }],
  });
  await act(async () => { root = create(React.createElement(Screen)); });
  const chips = root.root.findAllByType('TagChip');
  assert.deepEqual(chips.map((chip) => chip.props.name), ['Lunar Press']);
  await act(async () => chips[0].props.onPress());
  assert.deepEqual(Array.from(requests[0].filter.tags), ['group:"lunar press"']);
});

test('autocomplete replaces a partially quoted phrase, preserving its qualifier and negation', async () => {
  const completed = { name: 'Lunar Press', query: 'group:"Lunar Press"', category: 'artist', postCount: 5 };
  const calls = [];
  const { Screen, requests } = setup({ id: 'nhentai', type: 'nhentai' }, {
    searchTags: async (query, limit, source, type) => {
      calls.push({ query, type, source: source.id });
      return [completed];
    },
  });
  await act(async () => { root = create(React.createElement(Screen)); });
  const input = root.root.findByType('TextInput');
  await act(async () => {
    input.props.onFocus();
    input.props.onChangeText('language:english -group:"lunar pr');
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.deepEqual(calls, [{ query: 'lunar pr', type: 'group', source: 'nhentai' }]);
  const list = root.root.findAllByType('FlatList').find((node) => node.props.data?.[0] === completed);
  const suggestion = list.props.renderItem({ item: completed });
  await act(async () => suggestion.props.onPress());
  assert.deepEqual(Array.from(requests[0].filter.tags), ['language:english', '-group:"lunar press"']);
});

test('stale search rejection/finally cannot replace a newer search or clear its loader', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'first');
  await apply(defaults, 'second');
  assert.equal(requests.length, 2);
  await act(async () => { requests[0].reject(new Error('old failure')); });
  assert.equal(root.root.findAllByType('ActivityIndicator').length, 1);
  await act(async () => { requests[1].resolve([post('new')]); });
  assert.deepEqual(root.root.findAllByType('PostCard').map((card) => card.props.post.id), ['new']);
});

test('search pagination is single flight and stops after a duplicate page', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'sky');
  await act(async () => { requests[0].resolve([post('first')]); });
  await act(() => { bottom(); bottom(); bottom(); });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].page, 2);
  await act(async () => { requests[1].resolve([post('first')]); });
  await act(() => { bottom(); bottom(); });
  assert.equal(requests.length, 2);
});

test('failed search page retries the same page; old pagination cannot clear a new search', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'first');
  await act(async () => { requests[0].resolve([post('first')]); });
  await act(() => bottom());
  await act(async () => { requests[1].reject(new Error('page failed')); });
  await act(() => bottom());
  assert.equal(requests[2].page, 2);
  await apply(defaults, 'new');
  await act(async () => { requests[2].reject(new Error('old page failed')); });
  assert.equal(root.root.findAllByType('ActivityIndicator').length, 1);
  await act(async () => { requests[3].resolve([post('new')]); });
  assert.deepEqual(root.root.findAllByType('PostCard').map((card) => card.props.post.id), ['new']);
});

test('search preview focus subtracts the measured filter banner and uses actual viewport height', async () => {
  const { Screen, defaults, requests, viewport } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'sky');
  await act(async () => requests[0].resolve([{ ...post('clip'), sampleUrl: 'https://cdn.test/sample.mp4' }]));
  const scroll = () => root.root.findAllByType('ScrollView').find((node) => node.props.onScroll);
  await act(async () => scroll().props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
  await act(async () => root.root.findAllByType('View').filter((node) => node.props.onLayout).at(-1).props.onLayout({ nativeEvent: { layout: { y: 100 } } }));
  assert.deepEqual(viewport.visible, { offset: -100, height: 500 });
  assert.deepEqual([...viewport.focused.playable], ['clip']);
  await act(async () => scroll().props.onScroll({
    nativeEvent: { contentOffset: { y: 250 }, layoutMeasurement: { height: 480 }, contentSize: { height: 5000 } },
  }));
  assert.deepEqual(viewport.visible, { offset: 150, height: 480 });
  assert.equal(viewport.focused.offset, 150);
});

test('search header and quick chip open the same in-place source sheet', async () => {
  const { Screen, navigation } = setup();
  const navigated = [];
  navigation.navigate = (...args) => navigated.push(args);
  await act(async () => { root = create(React.createElement(Screen)); });
  const triggers = root.root.findAllByType('TouchableOpacity').filter((node) =>
    typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('Change source')
  );
  assert.equal(triggers.length, 2);
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  await act(async () => { triggers[0].props.onPress(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, true);
  await act(async () => { root.root.findByType('SourceSheet').props.onClose(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  await act(async () => { triggers[1].props.onPress(); });
  await act(async () => { root.root.findByType('SourceSheet').props.onManage(); });
  assert.equal(navigated[0][0], 'Settings');
  assert.equal(navigated[0][1].section, 'sources');
});

test('results header collapses, reverses, and is forced visible when the search input receives focus', async () => {
  const { Screen, defaults, requests, viewport } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'landscape');
  await act(async () => requests[0].resolve([post('one')]));
  await act(async () => root.root.findByProps({ testID: 'scroll-away-header' }).props.onLayout({ nativeEvent: { layout: { height: 100 } } }));
  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const translateY = () => root.root.findByProps({ testID: 'scroll-away-header' }).props.style.find((s) => s && s.transform)?.transform?.[0]?.translateY?.value;
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 112);
  const move = (y) => act(async () => scroll().props.onScroll({ nativeEvent: {
    contentOffset: { y }, layoutMeasurement: { height: 500 }, contentSize: { height: 5000 },
  } }));
  await move(0); await move(250);
  assert.equal(translateY(), -100);
  await move(150);
  assert.equal(translateY(), 0);
  assert.equal(viewport.visible.height, 400);
  await move(260);
  await act(async () => root.root.findByType('TextInput').props.onFocus());
  assert.equal(translateY(), 0);
  await move(400);
  assert.equal(translateY(), 0);
});

test('SearchScreen keeps PostCard onPress reference stable across pagination', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'sky');
  await act(async () => requests[0].resolve([post('s1')]));
  const firstOnPress = root.root.findByType('PostCard').props.onPress;
  await act(() => bottom());
  await act(async () => requests[1].resolve([post('s2')]));
  const cards = root.root.findAllByType('PostCard');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].props.onPress, firstOnPress);
  assert.equal(cards[1].props.onPress, firstOnPress);
});

test('SearchDetail bottom padding includes safe-area bottom inset and suggestions offset follows searchBar layout', async () => {
  const scrollHeader = require('./helpers/scroll-away-header.cjs').loadScrollAwayHeader();
  const load = createLoader({
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value }, Keyboard: { dismiss() {} },
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'expo-image': { Image: { prefetch: async () => {} } },
    '../services/booruApi': { booruApi: {
      fetchPostsWithFilter: async () => [post('one')],
      fetchRedGifsNiches: async () => [],
      searchTags: async () => [{ name: 'sky', postCount: 10, category: 'general' }],
    } },
    '../services/nhentai': {}, '../services/hentaihavens': {},
    '@react-navigation/native': { useNavigation: () => ({ setParams() {}, navigate() {} }), useIsFocused: () => true },
    '../services/storage': { StorageService: {
      getFavorites: async () => [], getSearchHistory: async () => [], getFavoriteTags: async () => [], addSearchHistory: async () => {},
    } },
    '../components/PostCard': { PostCard: 'PostCard' }, '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SearchFilterModal': { SearchFilterModal: 'SearchFilterModal' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../navigation/rootNavigation': { pushViewer() {} }, '../theme/colors': { Colors: { dark: {} } },
    '../utils/media': { getMediaUrl: (url) => url, getMediaHeaders: () => ({}), isVideoPost: () => false, isImageMediaUrl: () => true },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), () => {}],
      useMountedIds: () => [null, () => {}],
      useFocusedCardIds: () => [new Set(), () => {}],
    },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../context/SourceContext': { useSource: () => ({ activeSource: { id: 'a', type: 'danbooru', name: 'A' } }) },
    '../utils/scrollAwayHeader': scrollHeader.hook,
    '../components/ScrollAwayHeader': scrollHeader.component,
    '../utils/imagePrefetch': { prefetchGridImages() {} },
    '../utils/listCache': {
      buildListCacheKey: () => 'search-key',
      SEARCH_LIST_TTL_MS: 1800000,
      getListCache: async () => null,
      setListCache: async () => {},
    },
  }, { console: { ...console, warn() {} } });
  const Screen = load(path.resolve(__dirname, '../src/screens/SearchScreen.tsx')).SearchScreen;
  const defaults = load(path.resolve(__dirname, '../src/types/booru.ts')).DEFAULT_FILTER_CONFIG;
  await act(async () => { root = create(React.createElement(Screen, { onBackPress: () => {} })); });
  await act(async () => { root.root.findByType('SearchFilterModal').props.onApply({ ...defaults, tags: ['sky'] }); });
  const resultsScroll = root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const bottomStyle = resultsScroll.props.contentContainerStyle.filter((s) => s && typeof s.paddingBottom === 'number').at(-1);
  assert.equal(bottomStyle.paddingBottom, 64);
});
