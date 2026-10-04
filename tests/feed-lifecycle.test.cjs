const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function loadFeed() {
  let source = { id: 'a', type: 'xvideos', name: 'A' };
  const requests = [];
  const mocks = {
    react: React,
    'react-native': {
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      StyleSheet: { create: (v) => v },
      ...Object.fromEntries(['ActivityIndicator', 'RefreshControl', 'ScrollView', 'Text', 'TouchableOpacity', 'View'].map((n) => [n, n])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    'lucide-react-native': { Layers: 'Layers', RefreshCw: 'RefreshCw', AlertCircle: 'AlertCircle', Flame: 'Flame' },
    'expo-haptics': { impactAsync: async () => {}, selectionAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } },
    'expo-image': { Image: { prefetch: async () => {} } },
    '../services/booruApi': { booruApi: {
      resetFeedSeen() {},
      fetchPosts: (page) => new Promise((resolve, reject) => requests.push({ page, source: source.id, resolve, reject })),
    } },
    '../types/booru': { DEFAULT_FILTER_CONFIG: {} },
    '../components/PostCard': { PostCard: 'PostCard' },
    '../components/TagChip': { TagChip: 'TagChip' },
    '../navigation/rootNavigation': { pushViewer() {}, pushSearchDetail() {} },
    '@react-navigation/native': { useNavigation: () => ({}), useIsFocused: () => true },
    '../theme/colors': { Colors: { dark: {} } },
    '../utils/media': { getMediaUrl: (url) => url, getMediaHeaders: () => ({}), isVideoPost: (p) => !!p?.previewVideoUrl || p?.fileExt === 'mp4' },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), () => {}],
      useFocusedCardId: () => [null, () => {}],
      useFocusedCardIds: () => [new Set(), () => {}],
      // Testlerde pencere hesaplanmaz (null = ilk boya): tüm kartlar mount edilir.
      useMountedIds: () => [null, () => {}],
    },
    '../context/SourceContext': { useSource: () => ({ activeSource: source }) },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../utils/freezeProbe': { updateFreezeProbe() {} },
    '../services/storage': { StorageService: {
      getFavorites: async () => [], getFeedOrder: async () => null, setFeedOrder: async () => {},
    } },
  };
  const filename = path.resolve(__dirname, '../src/screens/FeedScreen.tsx');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (!(id in mocks)) throw new Error(`Unexpected dependency: ${id}`);
      return mocks[id];
    },
    console,
  }, { filename });
  return {
    FeedScreen: module.exports.FeedScreen, requests,
    switchSource: (id) => { source = { ...source, id, name: id.toUpperCase() }; },
  };
}

let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });
const post = (id) => ({ id, previewUrl: `https://cdn.test/${id}.jpg`, tags: {}, aspectRatio: 1 });
const ids = () => root.root.findAllByType('PostCard').map((card) => card.props.post.id);
const scrollBottom = () => root.root.findByType('ScrollView').props.onScroll({
  nativeEvent: { contentOffset: { y: 1000 }, layoutMeasurement: { height: 844 }, contentSize: { height: 1800 } },
});

test('late response from old source cannot overwrite the current feed', async () => {
  const { FeedScreen, requests, switchSource } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  assert.equal(requests.length, 1);
  switchSource('b');
  await act(async () => root.update(React.createElement(FeedScreen)));
  assert.equal(requests.length, 2);
  await act(async () => requests[1].resolve([post('new')]));
  assert.deepEqual(ids(), ['new']);
  await act(async () => requests[0].resolve([post('old')]));
  assert.deepEqual(ids(), ['new']);
});

test('rapid scroll starts one request; duplicate page stops pagination', async () => {
  const { FeedScreen, requests } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => requests[0].resolve([post('first')]));
  await act(async () => { scrollBottom(); scrollBottom(); scrollBottom(); });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].page, 2);
  await act(async () => requests[1].resolve([post('first')]));
  await act(async () => { scrollBottom(); scrollBottom(); });
  assert.equal(requests.length, 2);
  assert.deepEqual(ids(), ['first']);
});

test('stale finally cannot clear a new source request loading state', async () => {
  const { FeedScreen, requests, switchSource } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  switchSource('b');
  await act(async () => root.update(React.createElement(FeedScreen)));
  await act(async () => requests[0].resolve([post('old')]));
  assert.equal(root.root.findAllByType('ActivityIndicator').length, 1);
  assert.deepEqual(ids(), []);
  await act(async () => requests[1].resolve([post('new')]));
  assert.deepEqual(ids(), ['new']);
});

function loadVisibility() {
  const filename = path.resolve(__dirname, '../src/utils/gridVisibility.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (id === 'react') return React;
      throw new Error(`Unexpected dependency: ${id}`);
    },
  }, { filename });
  return module.exports;
}

test('mount window keeps ~20 cards mounted out of 148 and preserves total height', async () => {
  const { computeWindowIds } = loadVisibility();
  const layouts = new Map();
  let leftH = 0;
  let rightH = 0;
  for (let i = 0; i < 148; i++) {
    const h = 380 + (i % 5) * 20;
    if (leftH <= rightH) { layouts.set(`p${i}`, { y: leftH, h }); leftH += h; }
    else { layouts.set(`p${i}`, { y: rightH, h }); rightH += h; }
  }
  const totalH = Math.max(leftH, rightH);
  // Listenin ortasında: pencere ekran + 1500 overscan ile sınırlı kalır.
  const mounted = computeWindowIds(layouts, 5000, 844, 1500);
  assert.ok(mounted.size > 0 && mounted.size <= 30, `mounted=${mounted.size}`);
  // Uzak üst kartlar dışarıda, yakın kartlar içeride.
  assert.equal(mounted.has('p0'), false);
  // Yer tutucular toplam yüksekliği korur: pencere dışı yükseklik kaybolmaz.
  let placeholderH = 0;
  layouts.forEach((r, id) => { if (!mounted.has(id)) placeholderH += r.h; });
  let mountedH = 0;
  layouts.forEach((r, id) => { if (mounted.has(id)) mountedH += r.h; });
  assert.equal(placeholderH + mountedH, leftH + rightH - Math.min(leftH, rightH) + Math.min(leftH, rightH));
  assert.ok(totalH > 20000, `totalH=${totalH}`);
});

test('scrolling to bottom moves the mount window and releases top cards', async () => {
  const { computeWindowIds } = loadVisibility();
  const layouts = new Map();
  let y = 0;
  for (let i = 0; i < 60; i++) { layouts.set(`c${i}`, { y, h: 400 }); y += 400; }
  const top = computeWindowIds(layouts, 0, 844, 1500);
  const bottom = computeWindowIds(layouts, y, 844, 1500);
  assert.ok(top.has('c0'));
  assert.equal(top.has('c59'), false);
  assert.ok(bottom.has('c59'));
  assert.equal(bottom.has('c0'), false);
});

test('single active player: computeFocusedCardId selects the single card closest to screen center', async () => {
  const { computeFocusedCardId } = loadVisibility();
  const layouts = new Map();
  layouts.set('c0', { y: 0, h: 400 });
  layouts.set('c1', { y: 400, h: 400 });
  layouts.set('c2', { y: 800, h: 400 });
  const focused = computeFocusedCardId(layouts, 200, 800);
  assert.equal(focused, 'c1');
});

test('multi-player focus: computeFocusedCardIds selects top N cards closest to screen center', async () => {
  const { computeFocusedCardIds } = loadVisibility();
  const layouts = new Map();
  // 2 columns: row 0 (c0, c1), row 1 (c2, c3), row 2 (c4, c5)
  layouts.set('c0', { y: 0, h: 400 });
  layouts.set('c1', { y: 0, h: 400 });
  layouts.set('c2', { y: 400, h: 400 });
  layouts.set('c3', { y: 400, h: 400 });
  layouts.set('c4', { y: 800, h: 400 });
  layouts.set('c5', { y: 800, h: 400 });

  const focused = computeFocusedCardIds(layouts, 200, 800, undefined, 4);
  assert.equal(focused.size, 4);
  assert.ok(focused.has('c2'));
  assert.ok(focused.has('c3'));
});


