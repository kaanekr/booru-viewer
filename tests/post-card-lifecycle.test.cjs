const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise the real card's mount/unmount decisions, replacing only native APIs.
// Native AVPlayer/Expo Go behaviour still needs an on-device browsing test.
function loadCard() {
  const stats = { created: 0, live: new Set(), listeners: new Map() };
  const mocks = {
    react: React,
    'react-native': {
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      Platform: { OS: 'ios' },
      StyleSheet: { create: (v) => v, absoluteFill: {} },
      Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
    },
    'expo-image': { Image: 'Image' },
    'expo-video': {
      VideoView: 'VideoView',
      useVideoPlayer: (_source, setup) => {
        const [player] = React.useState(() => {
          stats.created++;
          const p = {
            play() {},
            pause() { stats.paused = (stats.paused || 0) + 1; },
            release() { stats.released = (stats.released || 0) + 1; },
            replaceAsync: async () => {},
          };
          setup(p);
          return p;
        });
        React.useEffect(() => {
          stats.live.add(player);
          return () => stats.live.delete(player);
        }, [player]);
        return player;
      },
    },
    expo: { useEventListener: (player, event, callback) => {
      React.useEffect(() => {
        stats.listeners.set(player, callback);
        return () => stats.listeners.delete(player);
      }, [player, event, callback]);
    } },
    'expo-haptics': { impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' } },
    'lucide-react-native': { Heart: 'Heart', Play: 'Play', Volume2: 'Volume2' },
    '../theme/colors': { Colors: { dark: {} } },
    '../utils/media': {
      getMediaUrl: (url) => url || '', getMediaHeaders: () => ({}),
      isUnsupportedOnIOS: (url) => /\.webm(?:\?|$)/i.test(url),
    },
    '../utils/guards': { urlEndsWith: (url, ...extensions) =>
      typeof url === 'string' && extensions.some((ext) => url.split('?')[0].toLowerCase().endsWith(ext)) },
    '../services/proxyService': { proxyService: { hasWorker: () => false } },
    '../utils/imageLoadGate': { useLoadGate: () => [true, release] },
    '../utils/freezeProbe': { trackGridPlayer: () => release, recordFreezeEvent: () => {} },
    '../utils/gridPreviews': { useGridPreviewsEnabled: () => gridPreviewsOn },
  };
  const filename = path.resolve(__dirname, '../src/components/PostCard.tsx');
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
    setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename });
  return { PostCard: module.exports.PostCard, stats };
}

function release() {}
function onPress() {}
// Ayarlar'daki önizleme anahtarının test başına değeri (varsayılan açık).
let gridPreviewsOn = true;
const imagePost = (id = '1') => ({ id, previewUrl: `https://cdn.test/${id}.jpg`, tags: {}, aspectRatio: 1 });
const videoPost = () => ({ ...imagePost(), previewVideoUrl: 'https://cdn.test/preview.mp4' });
let root;
afterEach(async () => {
  if (root) await act(() => root.unmount());
  root = undefined;
  gridPreviewsOn = true;
});

test('200 photo cards create zero native players', async () => {
  const { PostCard, stats } = loadCard();
  await act(() => { root = create(React.createElement(React.Fragment, null,
    Array.from({ length: 200 }, (_, i) => React.createElement(PostCard, {
      key: i, post: imagePost(String(i)), onPress, videoActive: true,
    })))); });
  assert.equal(stats.created, 0);
});

test('MP4 cover and preview share one player; scrolling away releases it', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...videoPost(), previewUrl: 'https://cdn.test/cover.mp4' };
  const props = { post, onPress, videoActive: true };
  await act(() => { root = create(React.createElement(PostCard, props)); });
  assert.equal(stats.created, 1);
  assert.equal(root.root.findAllByType('VideoView').length, 1);
  await act(() => root.update(React.createElement(PostCard, { ...props, videoActive: false })));
  assert.equal(stats.live.size, 0);
  assert.equal(stats.released, 1);
});

test('tab blur releases a touched preview and does not resurrect it on focus', async () => {
  const { PostCard, stats } = loadCard();
  const props = { post: videoPost(), onPress, videoActive: false, screenActive: true };
  await act(() => { root = create(React.createElement(PostCard, props)); });
  await act(() => root.root.findByType('TouchableOpacity').props.onPressIn());
  assert.equal(stats.live.size, 1);
  await act(() => root.update(React.createElement(PostCard, { ...props, screenActive: false })));
  assert.equal(stats.live.size, 0);
  await act(() => root.update(React.createElement(PostCard, props)));
  assert.equal(stats.live.size, 0);
});

test('video preview wins over frame slideshow (single player, no flicker)', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...videoPost(), previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] };
  await act(() => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  assert.equal(stats.created, 1);
  assert.equal(root.root.findAllByType('VideoView').length, 1);
});

test('frame slideshow is fallback only when no playable video exists', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...imagePost(), previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] };
  await act(() => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  assert.equal(stats.created, 0);
  assert.equal(root.root.findAllByType('Image').length, 2);
});

test('terminal video error releases player and scrolling back does not retry', async () => {
  const { PostCard, stats } = loadCard();
  const props = { post: videoPost(), onPress, videoActive: true };
  await act(() => { root = create(React.createElement(PostCard, props)); });
  const callback = [...stats.listeners.values()][0];
  await act(() => callback({ status: 'error' }));
  assert.equal(stats.live.size, 0);
  await act(() => root.update(React.createElement(PostCard, { ...props, videoActive: false })));
  await act(() => root.update(React.createElement(PostCard, props)));
  assert.equal(stats.created, 1);
});

test('JPEG preview mislabeled as video never constructs a player', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...imagePost(), previewVideoUrl: 'https://cdn.test/medium.jpg?token=abc' };
  await act(() => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  assert.equal(stats.created, 0);
});

test('previews disabled in settings: no player, static cover only', async () => {
  gridPreviewsOn = false;
  const { PostCard, stats } = loadCard();
  const post = { ...videoPost(), previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] };
  await act(() => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  assert.equal(stats.created, 0);
  assert.equal(root.root.findAllByType('VideoView').length, 0);
  // Statik kapak durur: dokunma önizlemesi de tetiklenmez.
  await act(() => root.root.findByType('TouchableOpacity').props.onPressIn());
  assert.equal(stats.created, 0);
  assert.equal(root.root.findAllByType('VideoView').length, 0);
});
