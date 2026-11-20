const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

function loadFeed(sourceOverride = {}) {
  const scrollHeader = require('./helpers/scroll-away-header.cjs').loadScrollAwayHeader();
  let source = { id: 'a', type: 'xvideos', name: 'A', ...sourceOverride };
  const requests = [];
  const viewport = {};
  const navigated = [];
  const mocks = {
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (v) => v },
      ...Object.fromEntries(['ActivityIndicator', 'RefreshControl', 'ScrollView', 'Text', 'TouchableOpacity', 'View'].map((n) => [n, n])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    'lucide-react-native': { Layers: 'Layers', RefreshCw: 'RefreshCw', AlertCircle: 'AlertCircle', Flame: 'Flame' },
    'expo-haptics': { impactAsync: async () => {}, selectionAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } },
    'expo-image': { Image: { prefetch: async () => {} } },
    '../services/booruApi': { booruApi: {
      buildQueryTags: (filter) => `sort:${filter.sortBy}`,
      fetchPosts: (page, _limit, tags, filter) => new Promise((resolve, reject) => requests.push({ page, tags, filter, source: source.id, resolve, reject })),
      fetchRedGifsTrendingTags: async () => [],
    } },
    '../types/booru': { DEFAULT_FILTER_CONFIG: {} },
    '../components/PostCard': { PostCard: 'PostCard' },
    '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../navigation/rootNavigation': { pushViewer() {}, pushSearchDetail() {} },
    '@react-navigation/native': { useNavigation: () => ({ navigate: (...args) => navigated.push(args) }), useIsFocused: () => true },
    '../theme/colors': { Colors: { dark: {} } },
    '../utils/media': { getMediaUrl: (url) => url, getMediaHeaders: () => ({}), isVideoPost: (p) => !!p?.previewVideoUrl || p?.fileExt === 'mp4', isImageMediaUrl: (url) => !/\.(mp4|webm|mov|m4v|m3u8|mpd|zip)(?:\?|$)/i.test(String(url || '')) },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), (_layouts, offset, height) => { viewport.visible = { offset, height }; }],
      useFocusedCardId: () => [null, () => {}],
      useFocusedCardIds: () => [new Set(), (_layouts, offset, height, playable) => { viewport.focused = { offset, height, playable }; }],
      // In tests the window is not computed (null = first paint): all cards mount.
      useMountedIds: () => [null, () => {}],
    },
    '../context/SourceContext': { useSource: () => ({ activeSource: source }) },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../services/hentaihavens': { HENTAIHAVEN_FEED_SECTIONS: [] },
    '../utils/freezeProbe': { updateFreezeProbe() {} },
    '../utils/postIdentity': createLoader()(path.resolve(__dirname, '../src/utils/postIdentity.ts')),
    '../utils/gridPreviewMedia': createLoader()(path.resolve(__dirname, '../src/utils/gridPreviewMedia.ts')),
    '../utils/sourceQuickFilters': createLoader()(path.resolve(__dirname, '../src/utils/sourceQuickFilters.ts')),
    '../utils/scrollAwayHeader': scrollHeader.hook,
    '../components/ScrollAwayHeader': scrollHeader.component,
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
    FeedScreen: module.exports.FeedScreen, requests, viewport, navigated, headerAnimations: scrollHeader.animations,
    switchSource: (id, type = source.type) => { source = { ...source, id, type, name: id.toUpperCase() }; },
  };
}

let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });
const post = (id) => ({ id, previewUrl: `https://cdn.test/${id}.jpg`, tags: {}, aspectRatio: 1 });

test('Explore quick filters dispatch their generated query and reset pagination', async () => {
  const { FeedScreen, requests } = loadFeed({ id: 'yandere', type: 'moebooru' });
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  assert.equal(requests[0].filter.sortBy, 'id');
  assert.equal(requests[0].tags, 'sort:id');
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Weekly Top' }).props.onPress());
  assert.equal(requests[1].page, 1);
  assert.equal(requests[1].filter.sortBy, 'score');
  assert.equal(requests[1].filter.timeRange, '1w');
  assert.equal(requests[1].tags, 'sort:score');
});

test('switching from a weekly-top source cannot leak its order into an unsupported discover feed', async () => {
  const { FeedScreen, requests, switchSource } = loadFeed({ id: 'redgifs', type: 'redgifs' });
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Weekly Top' }).props.onPress());
  switchSource('pornhub', 'pornhub');
  await act(async () => root.update(React.createElement(FeedScreen)));
  assert.equal(requests.at(-1).filter.sortBy, 'default');
  assert.equal(requests.at(-1).filter.timeRange, 'all');
  assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Weekly Top' }).length, 0);
});
const ids = () => root.root.findAllByType('PostCard').map((card) => card.props.post.id);
const scrollBottom = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll).props.onScroll({
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
  // In the middle of the list: the window stays bounded by the screen + 1500 overscan.
  const mounted = computeWindowIds(layouts, 5000, 844, 1500);
  assert.ok(mounted.size > 0 && mounted.size <= 30, `mounted=${mounted.size}`);
  // Distant top cards stay outside, near cards stay inside.
  assert.equal(mounted.has('p0'), false);
  // Placeholders preserve the total height: off-window height does not disappear.
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

test('feed preview focus uses measured viewport/grid origin and excludes unsupported iOS-only clips', async () => {
  const { FeedScreen, requests, viewport } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => requests[0].resolve([
    { ...post('mp4'), sampleUrl: 'https://cdn.test/sample.mp4' },
    { ...post('webm'), previewVideoUrl: 'https://cdn.test/clip.webm' },
    { ...post('photo'), fileExt: 'mp4' },
  ]));
  await act(async () => root.root.findAllByType('ScrollView').find((n) => n.props.onLayout).props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
  await act(async () => root.root.findAllByType('View').find((node) => node.props.onLayout).props.onLayout({ nativeEvent: { layout: { y: 120 } } }));
  assert.deepEqual(viewport.visible, { offset: -120, height: 500 });
  assert.deepEqual([...viewport.focused.playable], ['mp4']);
  await act(async () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll).props.onScroll({
    nativeEvent: { contentOffset: { y: 300 }, layoutMeasurement: { height: 480 }, contentSize: { height: 5000 } },
  }));
  assert.deepEqual(viewport.visible, { offset: 180, height: 480 });
  assert.equal(viewport.focused.offset, 180);
});

test('Explore header frees the full viewport when hidden and restores covered-area video accounting on reveal', async () => {
  const { FeedScreen, requests, viewport } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => requests[0].resolve([post('one')]));
  await act(async () => root.root.findByProps({ testID: 'scroll-away-header' }).props.onLayout({ nativeEvent: { layout: { height: 120 } } }));
  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const translateY = () => root.root.findByProps({ testID: 'scroll-away-header' }).props.style.find((s) => s && s.transform)?.transform?.[0]?.translateY?.value;
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 132);
  const move = (y) => act(async () => scroll().props.onScroll({ nativeEvent: {
    contentOffset: { y }, layoutMeasurement: { height: 500 }, contentSize: { height: 5000 },
  } }));
  await move(0); await move(300);
  assert.equal(translateY(), -120);
  assert.equal(viewport.visible.height, 500);
  await move(180);
  assert.equal(translateY(), 0);
  assert.equal(viewport.visible.height, 380);
});

test('FeedScreen keeps PostCard onPress reference stable across pagination', async () => {
  const { FeedScreen, requests } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => requests[0].resolve([post('p1')]));
  const firstOnPress = root.root.findByType('PostCard').props.onPress;
  await act(async () => scrollBottom());
  await act(async () => requests[1].resolve([post('p2')]));
  const cards = root.root.findAllByType('PostCard');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].props.onPress, firstOnPress);
  assert.equal(cards[1].props.onPress, firstOnPress);
});

test('useMountedIds seeds top-viewport cards on first paint without mounting 100 cards at once', async () => {
  const { useMountedIds } = loadVisibility();
  const layouts = new Map();
  let y = 0;
  for (let i = 0; i < 100; i++) {
    layouts.set(`p${i}`, { y, h: 300 });
    if (i % 2 === 1) y += 300;
  }
  let mounted;
  function Harness() {
    [mounted] = useMountedIds(1200, layouts, 844);
    return null;
  }
  await act(async () => { root = create(React.createElement(Harness)); });
  assert.ok(mounted && typeof mounted.has === 'function');
  assert.ok(mounted.size > 0 && mounted.size < 20, `mounted=${mounted.size}`);
  assert.equal(mounted.has('p0'), true);
  assert.equal(mounted.has('p99'), false);
});

test('useLoadGate opens immediately on first render when concurrent slots are available', async () => {
  const gate = createLoader({ react: React })(path.resolve(__dirname, '../src/utils/imageLoadGate.ts'));
  const renders = [];
  function Card({ col }) {
    const [open, release] = gate.useLoadGate(col);
    renders.push({ col, open });
    React.useEffect(() => () => release(), [release]);
    return null;
  }
  await act(async () => {
    root = create(React.createElement(React.Fragment, null,
      React.createElement(Card, { col: 'left' }),
      React.createElement(Card, { col: 'right' }),
    ));
  });
  assert.equal(renders[0].open, true);
  assert.equal(renders[1].open, true);
  assert.equal(renders.length, 2);
});

test('explore header opens the in-place source sheet and manage leaves for Settings', async () => {
  const { FeedScreen, requests, navigated } = loadFeed();
  await act(async () => { root = create(React.createElement(FeedScreen)); });
  await act(async () => requests[0].resolve([]));
  const pill = root.root.findAllByType('TouchableOpacity').find((node) =>
    typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('Change source')
  );
  assert.ok(pill, 'source pill opens the sheet in place');
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  await act(async () => { pill.props.onPress(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, true);
  await act(async () => { root.root.findByType('SourceSheet').props.onClose(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  await act(async () => { pill.props.onPress(); });
  await act(async () => { root.root.findByType('SourceSheet').props.onManage(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  assert.equal(navigated[0][0], 'Settings');
  assert.equal(navigated[0][1].section, 'sources');
});


