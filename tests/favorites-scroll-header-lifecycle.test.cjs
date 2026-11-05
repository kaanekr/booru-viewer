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
      Dimensions: { get: () => ({ width: 390 }) }, StyleSheet: { create: (v) => v },
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

test('favorite masonry header hides/reveals without changing its 40-card page or content padding', async () => {
  const { animations } = await setup();
  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 210);
  await act(async () => { scroll().props.onScroll(metrics(0)); scroll().props.onScroll(metrics(300)); });
  assert.equal(animations.at(-1).config.toValue, -200);
  assert.equal(root.root.findAllByType('PostCard').length, 40);
  await act(async () => scroll().props.onScroll(metrics(270)));
  assert.equal(animations.at(-1).config.toValue, 0);
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 210);
});

test('switching to history resets the header and wires direction scrolling without breaking onEndReached', async () => {
  const { animations } = await setup();
  const history = root.root.findAllByType('TouchableOpacity').find((b) => b.findAllByType('Text').some((n) => String(n.props.children).startsWith('History')));
  await act(async () => history.props.onPress());
  const list = () => root.root.findByType('FlatList');
  assert.equal(list().props.data.length, 40);
  assert.equal(list().props.contentContainerStyle.at(-1).paddingTop, 210);
  await act(async () => { list().props.onScroll(metrics(0)); list().props.onScroll(metrics(300)); });
  assert.equal(animations.at(-1).config.toValue, -200);
  await act(async () => list().props.onEndReached());
  assert.equal(list().props.data.length, 80);
  await act(async () => list().props.onScroll(metrics(270)));
  assert.equal(animations.at(-1).config.toValue, 0);
});
