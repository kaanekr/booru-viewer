const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });
const post = (sourceId, id) => ({ sourceId, id, sourceName: sourceId, sampleUrl: `https://${sourceId}.test/${id}.jpg` });

function setup(storageOverrides = {}) {
  const timers = new Map(); let timerId = 0;
  const alerts = []; const indices = []; const scrolls = [];
  const backHandlers = new Set();
  const animation = () => ({ start: (callback) => callback?.() });
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((name) => [name, name])),
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value },
      Animated: { Value: class { setValue() {} }, View: 'AnimatedView', timing: animation, spring: animation },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      BackHandler: { addEventListener: (_event, fn) => { backHandlers.add(fn); return { remove: () => backHandlers.delete(fn) }; } },
      Platform: { OS: 'ios' },
      Alert: { alert: (...args) => alerts.push(args) }, Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {}, 'expo-file-system': {}, 'expo-image': { Image: { prefetch: async () => {} } }, 'expo-video': {},
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': {}, '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: { isFavorite: async () => false, toggleFavorite: async () => true, ...storageOverrides } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => false,
      getMediaUrl: (url) => url,
      getImageCacheKey: (url) => url,
      getMediaHeaders: () => ({}),
      isImageMediaUrl: () => true,
      getImageUris: () => [],
      getVideoCandidates: () => [],
      isUnsupportedOnIOS: () => false,
      resolveGelbooruOriginalUrl: () => null,
      resolveRealbooruVideoUrls: () => [],
      selectRealbooruPlayable: () => null,
      resolveRealDimensions: () => null,
      resolveXVideosVideoUrls: () => [],
      resolveXHamsterVideoUrls: () => [],
      resolvePornhubVideoUrls: () => [],
      selectPrimaryVideoCandidate: () => null,
      checkMp4UpgradeAvailable: () => false,
    },
    '../services/sexcom': {}, '../services/hentaihavens': {}, '../services/nhentai': {},
  }, {
    setInterval: (callback) => { const key = ++timerId; timers.set(key, callback); return key; },
    clearInterval: (key) => timers.delete(key),
  });
  return {
    Viewer: load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal,
    props: {
      posts: [post('a', '42'), post('b', '42'), post('c', '43')], initialIndex: 0,
      visible: true, asScreen: true, onClose() {}, onTagPress() {},
      onIndexChange: (index) => indices.push(index),
    },
    timers, alerts, indices, scrolls, backHandlers,
    options: { createNodeMock: ({ type }) => type === 'FlatList' ? {
      scrollToIndex: (value) => scrolls.push(value), scrollToOffset() {},
    } : null },
  };
}
const button = (label) => root.root.findByProps({ accessibilityLabel: label });

test('viewer can hide, reopen and empty its list without changing hook order', async () => {
  const { Viewer, props, options } = setup();
  await act(() => { root = create(React.createElement(Viewer, { ...props, visible: false }), options); });
  await act(() => root.update(React.createElement(Viewer, props)));
  assert.equal(root.root.findAllByType('FlatList').length, 1);
  await act(() => root.update(React.createElement(Viewer, { ...props, visible: false })));
  await act(() => root.update(React.createElement(Viewer, { ...props, posts: [] })));
  assert.equal(root.root.findAllByType('FlatList').length, 0);
});

test('slideshow advances, releases its timer on suspend and stays stopped on return', async () => {
  const { Viewer, props, options, timers, indices } = setup();
  await act(() => { root = create(React.createElement(Viewer, props), options); });
  await act(() => button('Start slideshow').props.onPress());
  assert.equal(timers.size, 1);
  await act(() => [...timers.values()][0]());
  assert.equal(indices.at(-1), 1);
  await act(() => root.update(React.createElement(Viewer, { ...props, suspended: true })));
  assert.equal(timers.size, 0);
  await act(() => root.update(React.createElement(Viewer, props)));
  assert.equal(timers.size, 0);
  assert.ok(button('Start slideshow'));
});

test('jump to post validates bounds and moves to the requested index', async () => {
  const { Viewer, props, options, alerts, indices, scrolls } = setup();
  await act(() => { root = create(React.createElement(Viewer, props), options); });
  await act(() => button('Jump to post').props.onPress());
  await act(() => button('Post number').props.onChangeText('0'));
  await act(() => button('Go to post').props.onPress());
  assert.equal(alerts[0][0], 'Invalid page');
  await act(() => button('Post number').props.onChangeText('3'));
  await act(() => button('Go to post').props.onPress());
  assert.equal(indices.at(-1), 2);
  assert.equal(scrolls.at(-1).index, 2);
  assert.equal(root.root.findAllByType('TextInput').length, 0);
});

test('Android back closes the page-jump panel and releases its handler', async () => {
  const { Viewer, props, options, backHandlers } = setup();
  let closes = 0;
  await act(async () => { root = create(React.createElement(Viewer, { ...props, onClose: () => { closes++; } }), options); });
  await act(() => button('Jump to post').props.onPress());
  assert.equal(backHandlers.size, 1);
  await act(() => { assert.equal([...backHandlers][0](), true); });
  assert.equal(root.root.findAllByType('TextInput').length, 0);
  assert.equal(backHandlers.size, 0);
  assert.equal(closes, 0);
});

test('late favorite reads from the previous source cannot light the new post heart', async () => {
  const reads = [];
  const { Viewer, props, options } = setup({ isFavorite: () => new Promise((resolve) => reads.push(resolve)) });
  await act(() => { root = create(React.createElement(Viewer, props), options); });
  await act(() => root.root.findByType('FlatList').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 390 } } }));
  await act(() => reads[1](false));
  await act(() => reads[0](true));
  assert.ok(button('Save favorite'));
});

test('double tap writes once; completion for an old post does not change the new post heart', async () => {
  let resolveWrite; let writes = 0;
  const { Viewer, props, options } = setup({ toggleFavorite: () => {
    writes++; return new Promise((resolve) => { resolveWrite = resolve; });
  } });
  await act(() => { root = create(React.createElement(Viewer, props), options); });
  const toggle = button('Save favorite').props.onPress;
  let pending;
  await act(async () => { pending = toggle(); void toggle(); });
  assert.equal(writes, 1);
  await act(() => root.root.findByType('FlatList').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 390 } } }));
  await act(async () => { resolveWrite(true); await pending; });
  assert.ok(button('Save favorite'));
});

test('favorite write failure shows an error and enables retry', async () => {
  const { Viewer, props, options, alerts } = setup({ toggleFavorite: async () => { throw new Error('disk full'); } });
  await act(() => { root = create(React.createElement(Viewer, props), options); });
  await act(() => button('Save favorite').props.onPress());
  assert.equal(alerts[0][0], 'Could not save favorite');
  assert.equal(button('Save favorite').props.disabled, false);
});

test('FlatList callbacks and inactive PostPageItem props stay stable across chrome state updates', async () => {
  const nativeScrollCalls = [];
  const { Viewer, props } = setup();
  const options = {
    createNodeMock: ({ type }) => type === 'FlatList' ? {
      scrollToIndex() {},
      scrollToOffset() {},
      getNativeScrollRef: () => ({ setNativeProps: (p) => nativeScrollCalls.push(p) }),
    } : null,
  };
  await act(() => { root = create(React.createElement(Viewer, props), options); });
  const list1 = root.root.findByType('FlatList').props;
  const inactive1 = list1.renderItem({ item: props.posts[1], index: 1 });

  await act(() => button('Jump to post').props.onPress());
  await act(() => button('Post number').props.onChangeText('2'));
  const list2 = root.root.findByType('FlatList').props;
  assert.equal(list1.keyExtractor, list2.keyExtractor);
  assert.equal(list1.getItemLayout, list2.getItemLayout);
  assert.equal(list1.onMomentumScrollEnd, list2.onMomentumScrollEnd);
  assert.equal(inactive1.props.onTagsResolved, list2.renderItem({ item: props.posts[1], index: 1 }).props.onTagsResolved);
  assert.equal(inactive1.props.onOpenDetails, list2.renderItem({ item: props.posts[1], index: 1 }).props.onOpenDetails);

  await act(() => button('Cancel jump').props.onPress());
  await act(() => inactive1.props.onZoomChange(true));
  await act(() => inactive1.props.onZoomChange(true));
  assert.equal(nativeScrollCalls.length, 1);
  assert.equal(nativeScrollCalls[0].scrollEnabled, false);
  await act(() => inactive1.props.onZoomChange(false));
  assert.equal(nativeScrollCalls.length, 2);
  assert.equal(nativeScrollCalls[1].scrollEnabled, true);
});

test('asScreen video edge-swipe tracks horizontal finger movement and springs back or closes', async () => {
  const panConfigs = [];
  const animatedValues = [];
  const springTargets = [];
  const timingTargets = [];
  let closes = 0;
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((name) => [name, name])),
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value },
      Animated: {
        Value: class {
          constructor(v) { this.val = v; this.calls = []; animatedValues.push(this); }
          setValue(v) { this.val = v; this.calls.push(v); }
          stopAnimation() {}
        },
        View: 'AnimatedView',
        timing: (_v, cfg) => { timingTargets.push(cfg.toValue); return { start: (cb) => cb?.() }; },
        spring: (_v, cfg) => { springTargets.push(cfg.toValue); return { start: (cb) => cb?.() }; },
      },
      PanResponder: {
        create: (cfg) => { panConfigs.push(cfg); return { panHandlers: { __cfg: cfg } }; },
      },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'android' },
      Alert: { alert() {} },
      Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 44, right: 44 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {}, 'expo-file-system': {}, 'expo-image': { Image: 'Image' }, 'expo-video': {},
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': {}, '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: { isFavorite: async () => false } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => true,
      getMediaUrl: (url) => url, getMediaHeaders: () => ({}),
      isImageMediaUrl: () => false, getImageUris: () => [],
      getVideoCandidates: () => [], isUnsupportedOnIOS: () => false,
      resolveGelbooruOriginalUrl: () => null, resolveRealbooruVideoUrls: () => [],
      selectRealbooruPlayable: () => null, resolveRealDimensions: () => null,
      resolveXVideosVideoUrls: () => [], resolveXHamsterVideoUrls: () => [],
      resolvePornhubVideoUrls: () => [], selectPrimaryVideoCandidate: () => null,
      checkMp4UpgradeAvailable: () => false,
    },
    '../services/sexcom': {}, '../services/hentaihavens': {}, '../services/nhentai': {},
  });
  const Viewer = load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal;
  await act(() => {
    root = create(React.createElement(Viewer, {
      posts: [post('a', '42')], initialIndex: 0, visible: true, asScreen: true,
      onClose: () => { closes++; }, onTagPress() {},
    }));
  });
  const edgeView = root.root.findAllByType('View').find((v) => v.props?.__cfg);
  assert.ok(edgeView, 'edge gesture area should mount for asScreen video');
  const edgeCfg = edgeView.props.__cfg;
  const translateXVal = animatedValues[0];
  edgeCfg.onPanResponderMove({}, { dx: 45, dy: 0 });
  assert.equal(translateXVal.val, 45);
  edgeCfg.onPanResponderRelease({}, { dx: 45, vx: 0.1 });
  assert.equal(springTargets.at(-1), 0);
  assert.equal(closes, 0);
  edgeCfg.onPanResponderRelease({}, { dx: 110, vx: 0.6 });
  assert.equal(closes, 1);

  // Verify landscape safe-area insets are applied to top and bottom floating bars
  const topBar = root.root.findAllByType('View').find((v) =>
    Array.isArray(v.props.style) && v.props.style.some((s) => s && s.left === 52 && s.right === 52 && s.top === 47)
  );
  assert.ok(topBar, 'topBar should include landscape insets.left and insets.right');
});

test('unified video controls auto-hide and toggle together with viewer chrome without desync', async () => {
  const eventHandlers = new Map();
  const timeouts = new Map();
  let nextTimeoutId = 0;
  let timelineTickCount = 0;
  const mockPlayer = {
    loop: true,
    muted: false,
    playing: true,
    currentTime: 1,
    duration: 20,
    timeUpdateEventInterval: 0.25,
    pause() { this.playing = false; },
    play() { this.playing = true; },
    replaceAsync: async () => {},
    seekBy() {},
  };
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((name) => [name, name])),
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value, absoluteFill: {} },
      Animated: {
        Value: class { setValue() {} },
        View: 'AnimatedView',
        timing: () => ({ start: (cb) => cb?.() }),
        spring: () => ({ start: (cb) => cb?.() }),
      },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'ios' }, Alert: { alert() {} }, Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {
      useEvent: (_p, eventName, init) => {
        if (eventName === 'playingChange') return { isPlaying: true };
        return init;
      },
      useEventListener: (_p, eventName, fn) => { eventHandlers.set(eventName, fn); },
    },
    'expo-file-system': {},
    'expo-image': { Image: 'Image' },
    'expo-video': { useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' },
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': { proxyService: { hasWorker: () => false, isProxiedUrl: () => false } },
    '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: { isFavorite: async () => false, getImageQuality: async () => 'auto' } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => true,
      getMediaUrl: (url) => url, getMediaHeaders: () => ({}),
      isImageMediaUrl: () => false, getImageUris: () => ({ sampleUri: '', fullUri: '', placeholderUri: '' }),
      getVideoCandidates: (p) => [p.originalUrl], isUnsupportedOnIOS: () => false,
      resolveGelbooruOriginalUrl: async () => null, resolveRealbooruVideoUrls: async () => null,
      selectRealbooruPlayable: () => null, resolveRealDimensions: async () => null,
      resolveXVideosVideoUrls: async () => null, resolveXHamsterVideoUrls: async () => null,
      resolvePornhubVideoUrls: async () => null, selectPrimaryVideoCandidate: (r, c) => r || c[0],
      checkMp4UpgradeAvailable: async () => null,
    },
    '../services/sexcom': {}, '../services/hentaihavens': {}, '../services/nhentai': {},
  }, {
    setTimeout: (fn, ms) => { const id = ++nextTimeoutId; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timeouts.delete(id); },
  });
  const Viewer = load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal;
  const videoPost = {
    id: 'vid_1', sourceId: 'xvideos', sourceName: 'XVideos', fileExt: 'mp4',
    previewUrl: 'https://v.test/p.jpg', sampleUrl: 'https://v.test/p.jpg', originalUrl: 'https://v.test/v.mp4',
  };
  const ViewerWithMockedList = (p) => React.createElement(Viewer, p);
  await act(async () => {
    root = create(React.createElement(ViewerWithMockedList, {
      posts: [videoPost], initialIndex: 0, visible: true, asScreen: true, onClose() {}, onTagPress() {},
    }));
  });
  // Mount the actual FlatList item inside a separate renderer connected to the same state via renderItem
  const itemEl = root.root.findByType('FlatList').props.renderItem({ item: videoPost, index: 0 });
  let pageRoot;
  await act(async () => { pageRoot = create(itemEl); });
  try {
    assert.ok(button('Jump to post'), 'topBar visible initially');
    assert.equal(pageRoot.root.findAllByType('VideoView').length, 1);

    // 250ms playback timeUpdate updates isolated timeline without breaking or throwing
    await act(async () => {
      eventHandlers.get('timeUpdate')?.({ currentTime: 5 });
      timelineTickCount++;
    });
    assert.equal(timelineTickCount, 1);
    assert.ok(pageRoot.root.findAllByType('Text').some((t) => t.props.children === '0:05'));

    // Trigger the 3.5s auto-hide timer -> hides BOTH ImageViewerModal bars and VideoPlayerView controls
    const hideTimer = [...timeouts.values()].find((t) => t.ms === 3500);
    assert.ok(hideTimer, '3500ms auto-hide timer should be scheduled');
    await act(async () => { hideTimer.fn(); });
    assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Jump to post' }).length, 0);
    const updatedItem = root.root.findByType('FlatList').props.renderItem({ item: videoPost, index: 0 });
    await act(async () => { pageRoot.update(updatedItem); });
    assert.equal(pageRoot.root.findAllByType('Text').some((t) => t.props.children === '0:05'), false);

    // Single tap on video brings BOTH back in sync (never inverted)
    const tapCatcher = pageRoot.root.findAllByType('TouchableWithoutFeedback').at(-1);
    await act(async () => { tapCatcher.props.onPress(); });
    assert.ok(button('Jump to post'), 'topBar reappears in sync on tap');
  } finally {
    await act(async () => { pageRoot.unmount(); });
  }
});

test('PostInfoModal uses dynamic dimensions, iOS insets.top, omits fake rows, and cleans toast timers', async () => {
  const clearedTimeouts = [];
  const activeTimeouts = new Map();
  let tid = 0;
  let dims = { width: 844, height: 390 };
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['Modal', 'ScrollView', 'Text', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])),
      useWindowDimensions: () => dims,
      StyleSheet: { create: (v) => v, hairlineWidth: 1, absoluteFill: {} },
      Animated: {
        Value: class {
          setValue() {}
          stopAnimation() {}
          interpolate() { return 0.5; }
        },
        View: 'AnimatedView',
        timing: () => ({ start: (cb) => cb?.() }),
        spring: () => ({ start: (cb) => cb?.() }),
      },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      Platform: { OS: 'ios' },
      Linking: { canOpenURL: async () => false },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, notificationAsync() {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    'expo-clipboard': { setStringAsync: async () => {} },
    '../services/storage': {
      StorageService: {
        getImageQuality: async () => 'auto',
        isFavoriteTag: async () => false,
        isBlacklistedTag: async () => false,
      },
    },
    '../services/nhentai': { nhentaiTagQuery: (t) => t },
    '../services/hentaihavens': { hentaiHavenTagQuery: (t) => t, isHentaiHavenOfficialGenre: () => false },
    '../utils/media': { resolveRealDimensions: async () => null },
    '../utils/guards': { onlyStrings: (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []) },
  }, {
    setTimeout: (fn, ms) => { const id = ++tid; activeTimeouts.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { clearedTimeouts.push(id); activeTimeouts.delete(id); },
  });
  const { PostInfoModal } = load(path.resolve(__dirname, '../src/components/PostInfoModal.tsx'));
  const samplePost = {
    id: '100', sourceId: 'danbooru', sourceName: 'Danbooru',
    previewUrl: 'https://x.test/p.jpg', sampleUrl: 'https://x.test/s.jpg', originalUrl: 'https://x.test/o.png',
    width: 1000, height: 1200, aspectRatio: 1000 / 1200, rating: 's', score: 12, favCount: 12,
    tags: { artist: [], character: [], copyright: [], general: ['sky'], meta: [] },
    allTags: ['sky'], createdAt: '2025-01-01T00:00:00Z',
  };
  await act(async () => {
    root = create(React.createElement(PostInfoModal, {
      visible: true, post: samplePost, onClose() {}, onSearchTag() {},
    }));
  });
  // Uses dynamic landscape height (390 * 0.92 = 359) and applies insets.top (47) on iOS
  const backdropContainer = root.root.findByType('Modal').children[0];
  assert.equal(backdropContainer.props.style[1].paddingTop, 47);
  const animatedViews = root.root.findAllByType('AnimatedView');
  const sheetView = animatedViews.find((v) => Array.isArray(v.props.style) && v.props.style.some((s) => s && s.height === 359));
  assert.ok(sheetView, 'sheet height should react to useWindowDimensions()');

  // Fake placeholder rows removed
  const allTexts = root.root.findAllByType('Text').map((t) => t.props.children);
  assert.equal(allTexts.includes('Notes'), false);
  assert.equal(allTexts.includes('Childs'), false);
  assert.equal(allTexts.includes('Parent ID'), false);

  // Toast timer is cleaned up on unmount
  const idBtn = root.root.findAllByType('TouchableOpacity').find((b) =>
    b.findAllByType('Text').some((t) => t.props.children === 'ID')
  );
  await act(async () => { await idBtn.props.onPress(); });
  assert.equal(activeTimeouts.size, 1);
  await act(async () => { root.unmount(); });
  root = undefined;
  assert.equal(activeTimeouts.size, 0);
  assert.equal(clearedTimeouts.length, 1);
});

test('nhentai manga uses real aspect ratio and deduplicates page indicator updates on scroll', async () => {
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])),
      Dimensions: { get: () => ({ width: 400, height: 800 }) },
      useWindowDimensions: () => ({ width: 400, height: 800 }),
      StyleSheet: { create: (v) => v, absoluteFill: {} },
      Animated: { Value: class { setValue() {} }, View: 'AnimatedView', timing: () => ({ start: (cb) => cb?.() }), spring: () => ({ start: (cb) => cb?.() }) },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'ios' }, Alert: { alert() {} }, Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {}, 'expo-file-system': {}, 'expo-image': { Image: 'Image' }, 'expo-video': {},
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': {}, '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: { isFavorite: async () => false, getImageQuality: async () => 'auto' } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => false, getMediaUrl: (u) => u, getImageCacheKey: (u) => u, getMediaHeaders: () => ({}),
      isImageMediaUrl: () => true, getImageUris: () => ({ sampleUri: '', fullUri: '', placeholderUri: '' }),
      getVideoCandidates: () => [], isUnsupportedOnIOS: () => false,
      resolveGelbooruOriginalUrl: async () => null, resolveRealbooruVideoUrls: async () => null,
      selectRealbooruPlayable: () => null, resolveRealDimensions: async () => null,
      resolveXVideosVideoUrls: async () => null, resolveXHamsterVideoUrls: async () => null,
      resolvePornhubVideoUrls: async () => null, selectPrimaryVideoCandidate: () => null,
      checkMp4UpgradeAvailable: async () => null,
    },
    '../services/sexcom': {}, '../services/hentaihavens': {},
    '../services/nhentai': {
      resolveNHentaiGalleryDetail: async () => ({
        pages: ['https://i3.nhentai.net/g/1/1.jpg', 'https://i3.nhentai.net/g/1/2.jpg', 'https://i3.nhentai.net/g/1/3.jpg'],
        tags: { artist: [], character: [], copyright: [], general: [], meta: ['manga'] },
        allTags: [], pageCount: 3,
      }),
      rotateNhentaiImageHost: () => null,
    },
  });
  const Viewer = load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal;
  const mangaPost = {
    id: 'nh_1', sourceId: 'nhentai', sourceName: 'nhentai',
    previewUrl: 'https://t.test/1.jpg', sampleUrl: 'https://i.test/1.jpg', originalUrl: 'https://i.test/1.jpg',
    width: 400, height: 200, aspectRatio: 2, pageCount: 3,
  };
  await act(async () => {
    root = create(React.createElement(Viewer, {
      posts: [mangaPost], initialIndex: 0, visible: true, asScreen: true, onClose() {}, onTagPress() {},
    }));
  });
  const item = root.root.findByType('FlatList').props.renderItem({ item: mangaPost, index: 0 });
  let pageRoot;
  await act(async () => { pageRoot = create(item); });
  try {
    // Default height from post.width/post.height (400x200 => 200px, NOT 400 * 1.42 = 568px)
    const firstImg = pageRoot.root.findAllByType('Image')[0];
    assert.equal(firstImg.props.style.height, 200);

    // Measure actual page 1 height via onLoad (e.g. 400x300 => 300px)
    await act(async () => { firstImg.props.onLoad({ source: { width: 800, height: 600 } }); });
    assert.equal(pageRoot.root.findAllByType('Image')[0].props.style.height, 300);

    // Scroll stays on page 1 -> pill still shows 1 / 3; scrolling to page 2 -> updates to 2 / 3
    const scrollView = pageRoot.root.findByType('ScrollView');
    await act(async () => { scrollView.props.onScroll({ nativeEvent: { zoomScale: 1, contentOffset: { y: 10 } } }); });
    assert.ok(pageRoot.root.findAllByType('Text').some((t) => Array.isArray(t.props.children) && t.props.children.join('') === '1 / 3'));
    await act(async () => { scrollView.props.onScroll({ nativeEvent: { zoomScale: 1, contentOffset: { y: 200 } } }); });
    assert.ok(pageRoot.root.findAllByType('Text').some((t) => Array.isArray(t.props.children) && t.props.children.join('') === '2 / 3'));
  } finally {
    await act(async () => { pageRoot.unmount(); });
  }
});

test('interactive edge-swipe, vertical pull-to-dismiss, and 1:1 pull-up info sheet work without Modal lag', async () => {
  const panConfigs = [];
  const closeCalls = [];
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])),
      Dimensions: { get: () => ({ width: 400, height: 800 }) },
      useWindowDimensions: () => ({ width: 400, height: 800 }),
      StyleSheet: { create: (v) => v, absoluteFill: {} },
      Animated: {
        Value: class {
          constructor(v) { this._value = v; }
          setValue(v) { this._value = v; }
          stopAnimation() {}
          interpolate() { return 1; }
        },
        View: 'AnimatedView',
        timing: (val, cfg) => ({ start: (cb) => { val.setValue(cfg.toValue); cb?.({ finished: true }); } }),
        spring: (val, cfg) => ({ start: (cb) => { val.setValue(cfg.toValue); cb?.({ finished: true }); } }),
      },
      PanResponder: {
        create: (cfg) => {
          panConfigs.push(cfg);
          return { panHandlers: { __panCfg: cfg } };
        },
      },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'android' },
      Alert: { alert() {} },
      Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {}, 'expo-file-system': {}, 'expo-image': { Image: 'Image' }, 'expo-video': {},
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': {}, '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: { isFavorite: async () => false, getImageQuality: async () => 'auto' } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => false, getMediaUrl: (u) => u, getImageCacheKey: (u) => u, getMediaHeaders: () => ({}),
      isImageMediaUrl: () => true, getImageUris: () => ({ sampleUri: 'https://x.test/s.jpg', fullUri: 'https://x.test/f.jpg', placeholderUri: 'https://x.test/p.jpg' }),
      getVideoCandidates: () => [], isUnsupportedOnIOS: () => false,
      resolveGelbooruOriginalUrl: async () => null, resolveRealbooruVideoUrls: async () => null,
      selectRealbooruPlayable: () => null, resolveRealDimensions: async () => null,
      resolveXVideosVideoUrls: async () => null, resolveXHamsterVideoUrls: async () => null,
      resolvePornhubVideoUrls: async () => null, selectPrimaryVideoCandidate: () => null,
      checkMp4UpgradeAvailable: async () => null,
    },
    '../services/sexcom': {}, '../services/hentaihavens': {},
    '../services/nhentai': { resolveNHentaiGalleryDetail: async () => null, rotateNhentaiImageHost: () => null },
  });
  const Viewer = load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal;
  const post = {
    id: 'g1', sourceId: 'danbooru', sourceName: 'Danbooru',
    previewUrl: 'https://x.test/p.jpg', sampleUrl: 'https://x.test/s.jpg', originalUrl: 'https://x.test/f.jpg',
    width: 800, height: 1000, aspectRatio: 0.8,
  };
  await act(async () => {
    root = create(React.createElement(Viewer, {
      posts: [post], initialIndex: 0, visible: true, asScreen: true,
      onClose: (immediate) => closeCalls.push(immediate), onTagPress() {},
    }));
  });

  // 1. PostInfoModal uses inline layer (useModal=false) + shared externalTranslateY
  const info = root.root.findByType('PostInfo');
  assert.equal(info.props.useModal, false);
  assert.ok(info.props.externalTranslateY);

  // 2. Android shows 44px leftEdgeGestureArea even for photos, doesn't steal start tap, and calls onClose(true) on swipe
  const edgeCfg = panConfigs[0];
  assert.equal(edgeCfg.onStartShouldSetPanResponder(), false);
  assert.equal(edgeCfg.onMoveShouldSetPanResponderCapture({}, { dx: 10, dy: 0 }), true);
  edgeCfg.onPanResponderGrant({}, { dx: 10, dy: 0 });
  edgeCfg.onPanResponderMove({}, { dx: 120, dy: 0 });
  await act(async () => { edgeCfg.onPanResponderRelease({}, { dx: 120, dy: 0, vx: 0.5 }); });
  assert.deepEqual(closeCalls, [true]);

  // 3. Upward pull on PostPageItem immediately enters peeking & moves sheet translateY 1:1 before release
  const item = root.root.findByType('FlatList').props.renderItem({ item: post, index: 0 });
  let pageRoot;
  await act(async () => { pageRoot = create(item); });
  try {
    const vertView = pageRoot.root.findAllByType('AnimatedView').find((v) => v.props.__panCfg);
    const vertCfg = vertView.props.__panCfg;
    assert.equal(vertCfg.onMoveShouldSetPanResponderCapture({}, { dx: 0, dy: -8, numberActiveTouches: 1 }), true);
    await act(async () => {
      vertCfg.onPanResponderGrant({}, { dx: 0, dy: -8 });
      vertCfg.onPanResponderMove({}, { dx: 0, dy: -60 });
    });
    assert.equal(root.root.findByType('PostInfo').props.isPeeking, true);
    assert.ok(root.root.findByType('PostInfo').props.externalTranslateY._value < Math.round(800 * 0.92));

    await act(async () => {
      vertCfg.onPanResponderRelease({}, { dx: 0, dy: -80, vy: -0.5 });
    });
    assert.equal(root.root.findByType('PostInfo').props.visible, true);

    // 4. Downward pull-to-dismiss calls onClose(true)
    await act(async () => {
      vertCfg.onPanResponderGrant({}, { dx: 0, dy: 8 });
      vertCfg.onPanResponderMove({}, { dx: 0, dy: 110 });
      vertCfg.onPanResponderRelease({}, { dx: 0, dy: 110, vy: 0.6 });
    });
    assert.deepEqual(closeCalls, [true, true]);
  } finally {
    await act(async () => { pageRoot.unmount(); });
  }
});

test('VideoPlayerView falls back to local File.downloadFileAsync when streaming fails without a proxy worker', async () => {
  const eventHandlers = new Map();
  const replacedSources = [];
  const downloadCalls = [];
  let playCalls = 0;
  const mockPlayer = {
    loop: false, muted: false, playing: false, duration: 10, currentTime: 0, timeUpdateEventInterval: 0.25,
    play() { playCalls++; }, pause() {}, seekBy() {}, release() {},
    replaceAsync: async (src) => { replacedSources.push(src); },
  };
  class MockDirectory {
    constructor() {}
    create() {}
    list() { return []; }
  }
  class MockFile {
    constructor(_dir, name) { this.uri = `file:///cache/video-fallback/${name}`; this.exists = false; this.size = 0; }
    static async downloadFileAsync(url, target, opts) {
      downloadCalls.push({ url, uri: target.uri, headers: opts.headers });
      opts.onProgress?.({ bytesWritten: 50, totalBytes: 100 });
      return { uri: target.uri };
    }
  }
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])),
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (v) => v, absoluteFill: {} },
      Animated: { Value: class { setValue() {} stopAnimation() {} interpolate() { return 1; } }, View: 'AnimatedView', timing: () => ({ start: (cb) => cb?.() }), spring: () => ({ start: (cb) => cb?.() }) },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'ios' }, Alert: { alert() {} }, Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {
      useEvent: (_t, _e, init) => init,
      useEventListener: (_t, event, fn) => { eventHandlers.set(event, fn); },
    },
    'expo-file-system': { Directory: MockDirectory, File: MockFile, Paths: { cache: 'file:///cache' } },
    'expo-image': { Image: 'Image' },
    'expo-video': {
      useVideoPlayer: (_src, init) => { init?.(mockPlayer); return mockPlayer; },
      VideoView: 'VideoView',
    },
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': { proxyService: { hasWorker: () => false, isProxiedUrl: () => false, forceProxyUrl: (u) => u } },
    '../theme/colors': { Colors: { dark: { primary: '#6366F1' } } },
    '../services/storage': { StorageService: { isFavorite: async () => false, getImageQuality: async () => 'auto' } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => true, getMediaUrl: (u) => u,
      getMediaHeaders: () => ({ Referer: 'https://realbooru.com/' }),
      isImageMediaUrl: () => false, getImageUris: () => ({ sampleUri: '', fullUri: '', placeholderUri: '' }),
      getVideoCandidates: (p) => [p.originalUrl], isUnsupportedOnIOS: () => false,
      resolveGelbooruOriginalUrl: async () => null, resolveRealbooruVideoUrls: async () => null,
      selectRealbooruPlayable: () => null, resolveRealDimensions: async () => null,
      resolveXVideosVideoUrls: async () => null, resolveXHamsterVideoUrls: async () => null,
      resolvePornhubVideoUrls: async () => null, selectPrimaryVideoCandidate: (r, c) => r || (Array.isArray(c) ? c[0] : null),
      checkMp4UpgradeAvailable: async () => null,
    },
    '../services/sexcom': {}, '../services/hentaihavens': {}, '../services/nhentai': {},
  });
  const Viewer = load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal;
  const videoPost = {
    id: 'rb_v1', sourceId: 'realbooru', sourceName: 'Realbooru',
    previewUrl: 'https://realbooru.com/t.jpg', sampleUrl: 'https://realbooru.com/v.mp4', originalUrl: 'https://realbooru.com/v.mp4',
    width: 720, height: 1280, aspectRatio: 720 / 1280,
  };
  await act(async () => {
    root = create(React.createElement(Viewer, {
      posts: [videoPost], initialIndex: 0, visible: true, asScreen: true, onClose() {}, onTagPress() {},
    }));
  });
  const item = root.root.findByType('FlatList').props.renderItem({ item: videoPost, index: 0 });
  let pageRoot;
  await act(async () => { pageRoot = create(item); });
  try {
    assert.equal(replacedSources.length, 1);
    assert.equal(replacedSources[0].uri, 'https://realbooru.com/v.mp4');

    // Simulate AVPlayer failing with -1202 (no Worker registered)
    await act(async () => {
      eventHandlers.get('statusChange')({ status: 'error' });
    });

    assert.equal(downloadCalls.length, 1);
    assert.equal(downloadCalls[0].url, 'https://realbooru.com/v.mp4');
    assert.equal(downloadCalls[0].headers.Referer, 'https://realbooru.com/');
    assert.equal(replacedSources.length, 2);
    assert.ok(replacedSources[1].uri.startsWith('file:///cache/video-fallback/v_'));
    assert.ok(replacedSources[1].uri.endsWith('.mp4'));
    assert.ok(playCalls >= 2);
  } finally {
    await act(async () => { pageRoot.unmount(); });
  }
});
