const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { loadScrollAwayHeader } = require('./helpers/scroll-away-header.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; });

async function setup() {
  const header = loadScrollAwayHeader();
  const posts = Array.from({ length: 90 }, (_, i) => ({
    id: String(i), sourceId: 'danbooru', sourceName: 'Danbooru', allTags: ['landscape'],
    tags: { general: ['landscape'] }, previewUrl: `https://cdn.test/${i}.jpg`, aspectRatio: 1,
  }));
  const load = createLoader({
    react: React,
    'react-native': {
      Dimensions: { get: () => ({ width: 390, height: 844 }) }, StyleSheet: { create: (v) => v },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, Alert: {},
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((n) => [n, n])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 24 }) },
    'lucide-react-native': new Proxy({}, { get: (_, n) => String(n) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    '../services/storage': { StorageService: { getFavorites: async () => posts, getFavoriteTags: async () => ['landscape'], getRecentViews: async () => posts } },
    '../services/backupService': { BackupService: { repairAndNormalizeStoredFavorites: async () => 0 } },
    '../components/PostCard': { PostCard: 'PostCard' },
    '@react-navigation/native': { useNavigation: () => ({}), useIsFocused: () => true },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../navigation/rootNavigation': {}, '../theme/colors': { Colors: { dark: {} }, TagColors: { general: {} } },
    '../utils/scrollAwayHeader': header.hook, '../components/ScrollAwayHeader': header.component,
  });
  const Screen = load(path.resolve(__dirname, '../src/screens/FavoritesScreen.tsx')).FavoritesScreen;
  await act(async () => { root = create(React.createElement(Screen)); });
  await act(async () => root.root.findByProps({ testID: 'scroll-away-header' }).props.onLayout({ nativeEvent: { layout: { height: 200 } } }));
  return header;
}
const metrics = (y) => ({ nativeEvent: { contentOffset: { y }, contentSize: { height: 5000 }, layoutMeasurement: { height: 500 } } });

test('favorite masonry header hides/reveals smoothly without breaking mount window or content padding', async () => {
  await setup();
  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const headerView = () => root.root.findByProps({ testID: 'scroll-away-header' });
  const translateY = () => {
    const t = headerView().props.style.find((s) => s && s.transform)?.transform?.[0]?.translateY;
    return t?.value;
  };
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 210);
  // Seeded initial mount window mounts top-viewport cards instead of all 40
  const initialCards = root.root.findAllByType('PostCard').length;
  assert.ok(initialCards > 0 && initialCards < 40, `initialCards=${initialCards}`);
  await act(async () => { scroll().props.onScroll(metrics(0)); scroll().props.onScroll(metrics(300)); });
  assert.equal(translateY(), -200);
  await act(async () => scroll().props.onScroll(metrics(100)));
  assert.equal(translateY(), 0);
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 210);
});

test('typing in favorites search does not reset or bounce the scroll header', async () => {
  await setup();
  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const headerView = () => root.root.findByProps({ testID: 'scroll-away-header' });
  const translateY = () => headerView().props.style.find((s) => s && s.transform)?.transform?.[0]?.translateY?.value;
  await act(async () => { scroll().props.onScroll(metrics(0)); scroll().props.onScroll(metrics(300)); });
  assert.equal(translateY(), -200);
  const input = root.root.findByType('TextInput');
  await act(async () => input.props.onChangeText('land'));
  assert.equal(translateY(), -200);
});

test('switching to history resets the header and wires direction scrolling without breaking onEndReached', async () => {
  await setup();
  const history = root.root.findAllByType('TouchableOpacity').find((b) => b.findAllByType('Text').some((n) => String(n.props.children).startsWith('History')));
  await act(async () => history.props.onPress());
  const list = () => root.root.findByType('FlatList');
  const headerView = () => root.root.findByProps({ testID: 'scroll-away-header' });
  const translateY = () => headerView().props.style.find((s) => s && s.transform)?.transform?.[0]?.translateY?.value;
  assert.equal(list().props.data.length, 40);
  assert.equal(list().props.contentContainerStyle.at(-1).paddingTop, 210);
  assert.equal(typeof list().props.getItemLayout, 'function');
  await act(async () => { list().props.onScroll(metrics(0)); list().props.onScroll(metrics(300)); });
  assert.equal(translateY(), -200);
  await act(async () => list().props.onEndReached());
  assert.equal(list().props.data.length, 80);
  await act(async () => list().props.onScroll(metrics(100)));
  assert.equal(translateY(), 0);
});

test('favorites masonry distributes cards by shortest column height rather than index parity', async () => {
  const header = loadScrollAwayHeader();
  const skewed = [
    { id: 'tall', sourceId: 'danbooru', tags: {}, previewUrl: 'https://cdn.test/1.jpg', aspectRatio: 0.6 },
    { id: 'short1', sourceId: 'danbooru', tags: {}, previewUrl: 'https://cdn.test/2.jpg', aspectRatio: 1.4 },
    { id: 'short2', sourceId: 'danbooru', tags: {}, previewUrl: 'https://cdn.test/3.jpg', aspectRatio: 1.4 },
  ];
  const load = createLoader({
    react: React,
    'react-native': {
      Dimensions: { get: () => ({ width: 390, height: 844 }) }, StyleSheet: { create: (v) => v },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, Alert: {},
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((n) => [n, n])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 24 }) },
    'lucide-react-native': new Proxy({}, { get: (_, n) => String(n) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    '../services/storage': { StorageService: { getFavorites: async () => skewed, getFavoriteTags: async () => [], getRecentViews: async () => [] } },
    '../services/backupService': { BackupService: { repairAndNormalizeStoredFavorites: async () => 0 } },
    '../components/PostCard': { PostCard: 'PostCard' },
    '@react-navigation/native': { useNavigation: () => ({}), useIsFocused: () => true },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../navigation/rootNavigation': {}, '../theme/colors': { Colors: { dark: {} }, TagColors: { general: {} } },
    '../utils/scrollAwayHeader': header.hook, '../components/ScrollAwayHeader': header.component,
  });
  const Screen = load(path.resolve(__dirname, '../src/screens/FavoritesScreen.tsx')).FavoritesScreen;
  await act(async () => { root = create(React.createElement(Screen)); });
  const cards = root.root.findAllByType('PostCard');
  assert.equal(cards.find((c) => c.props.post.id === 'tall').props.column, 'left');
  assert.equal(cards.find((c) => c.props.post.id === 'short1').props.column, 'right');
  assert.equal(cards.find((c) => c.props.post.id === 'short2').props.column, 'right');
});
