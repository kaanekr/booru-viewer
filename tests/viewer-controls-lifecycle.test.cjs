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
    expo: {}, 'expo-image': { Image: { prefetch: async () => {} } }, 'expo-video': {},
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': {}, '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: { isFavorite: async () => false, toggleFavorite: async () => true, ...storageOverrides } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {},
    '../utils/media': {
      isVideoPost: () => false,
      getMediaUrl: (url) => url,
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
