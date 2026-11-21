const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });

function setup() {
  const sources = [{ id: 'a' }, { id: 'b' }];
  const posts = [{ id: '42', sourceId: 'a' }, { id: '42', sourceId: 'b' }];
  const searches = []; const recent = [];
  let focused = true;
  let backCount = 0;
  const load = createLoader({
    react: React,
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
    '@react-navigation/native': { useIsFocused: () => focused },
    '../navigation/postsCache': { getCachedPosts: () => posts, deleteCachedPosts() {} },
    '../navigation/rootNavigation': { pushSearchDetail: (...args) => searches.push(args) },
    '../components/ImageViewerModal': { ImageViewerModal: 'Viewer' },
    '../services/storage': { StorageService: { addRecentView: async (p) => recent.push(p) } },
    '../utils/media': { isVideoPost: () => false },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../services/sources': { AVAILABLE_SOURCES: sources },
  });
  return {
    ViewerScreen: load(path.resolve(__dirname, '../src/screens/ViewerScreen.tsx')).ViewerScreen,
    props: {
      route: { params: { postsKey: 'session', initialIndex: 0, originTags: ['landscape'] } },
      navigation: { canGoBack: () => true, goBack: () => { backCount++; }, setOptions() {} },
    },
    searches, recent, backCount: () => backCount, focus: (value) => { focused = value; },
  };
}

test('viewer close and tag callbacks stay stable across unrelated renders', async () => {
  const { ViewerScreen, props } = setup();
  await act(() => { root = create(React.createElement(ViewerScreen, props)); });
  const first = root.root.findByType('Viewer').props;
  await act(() => root.update(React.createElement(ViewerScreen, props)));
  const second = root.root.findByType('Viewer').props;
  for (const key of ['onClose', 'onTagPress', 'onAddTagToSearch', 'onExcludeTagFromSearch']) assert.equal(first[key], second[key]);
});

test('double close pops once and selecting a tag follows the current post source', async () => {
  const { ViewerScreen, props, searches, backCount } = setup();
  await act(() => { root = create(React.createElement(ViewerScreen, props)); });
  await act(() => root.root.findByType('Viewer').props.onIndexChange(1));
  const viewer = root.root.findByType('Viewer').props;
  viewer.onTagPress('sky');
  assert.equal(searches[0][2].id, 'b');
  await act(() => { viewer.onClose(); viewer.onClose(); });
  assert.equal(backCount(), 1);
});

test('suspended viewer does not keep adding recent views', async () => {
  const { ViewerScreen, props, recent, focus } = setup();
  await act(() => { root = create(React.createElement(ViewerScreen, props)); });
  assert.equal(recent.length, 1);
  focus(false);
  await act(() => root.update(React.createElement(ViewerScreen, props)));
  await act(() => root.root.findByType('Viewer').props.onIndexChange(1));
  assert.equal(recent.length, 1);
});

test('immediate close disables stack pop animation to avoid double-slide after gesture', async () => {
  const setOptionsCalls = [];
  let backCount = 0;
  const load = createLoader({
    react: React,
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
    '@react-navigation/native': { useIsFocused: () => true },
    '../navigation/postsCache': { getCachedPosts: () => [{ id: '1', sourceId: 'a' }], deleteCachedPosts() {} },
    '../navigation/rootNavigation': { pushSearchDetail() {} },
    '../components/ImageViewerModal': { ImageViewerModal: 'Viewer' },
    '../services/storage': { StorageService: { addRecentView: async () => {} } },
    '../utils/media': { isVideoPost: () => false },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../services/sources': { AVAILABLE_SOURCES: [{ id: 'a' }] },
  });
  const { ViewerScreen } = load(path.resolve(__dirname, '../src/screens/ViewerScreen.tsx'));
  const origRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = (cb) => { cb(); return 1; };
  try {
    await act(() => {
      root = create(React.createElement(ViewerScreen, {
        route: { params: { postsKey: 'k', initialIndex: 0 } },
        navigation: {
          canGoBack: () => true,
          goBack: () => { backCount++; },
          setOptions: (opts) => setOptionsCalls.push(opts),
        },
      }));
    });
    await act(() => { root.root.findByType('Viewer').props.onClose(true); });
    assert.ok(setOptionsCalls.some((o) => o && o.animation === 'none'));
    assert.equal(backCount, 1);
  } finally {
    global.requestAnimationFrame = origRaf;
  }
});

test('videos keep native stack swipe-back enabled while excluding the timeline and pausing during scrub', async () => {
  const setOptionsCalls = [];
  const load = createLoader({
    react: React,
    'react-native': { useWindowDimensions: () => ({ width: 390, height: 844 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
    '@react-navigation/native': { useIsFocused: () => true },
    '../navigation/postsCache': { getCachedPosts: () => [{ id: '1', sourceId: 'a' }], deleteCachedPosts() {} },
    '../navigation/rootNavigation': { pushSearchDetail() {} },
    '../components/ImageViewerModal': { ImageViewerModal: 'Viewer' },
    '../services/storage': { StorageService: { addRecentView: async () => {} } },
    '../utils/media': { isVideoPost: () => true },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../services/sources': { AVAILABLE_SOURCES: [{ id: 'a' }] },
  });
  const { ViewerScreen } = load(path.resolve(__dirname, '../src/screens/ViewerScreen.tsx'));
  await act(() => {
    root = create(React.createElement(ViewerScreen, {
      route: { params: { postsKey: 'v', initialIndex: 0 } },
      navigation: {
        canGoBack: () => true,
        goBack() {},
        setOptions: (opts) => setOptionsCalls.push(opts),
      },
    }));
  });
  const initialOpts = setOptionsCalls.at(-1);
  assert.equal(initialOpts.gestureEnabled, true);
  assert.equal(initialOpts.gestureResponseDistance.end, 48);
  assert.equal(initialOpts.gestureResponseDistance.bottom, 844 - 34 - 165);

  // While scrubbing the timeline, native swipe-back pauses; releasing restores it
  await act(() => { root.root.findByType('Viewer').props.onScrubbingChange(true); });
  assert.equal(setOptionsCalls.at(-1).gestureEnabled, false);
  await act(() => { root.root.findByType('Viewer').props.onScrubbingChange(false); });
  assert.equal(setOptionsCalls.at(-1).gestureEnabled, true);
});
