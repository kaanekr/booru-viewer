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

// Exercise the real card's mount/unmount decisions, replacing only native APIs.
// Native AVPlayer/Expo Go behaviour still needs an on-device browsing test.
function loadCard(options = {}) {
  const stats = { created: 0, live: new Set(), listeners: new Map(), sources: [] };
  let now = Date.now();
  stats.advance = (ms) => { now += ms; };
  const timeouts = new Map();
  let timeoutId = 0;
  stats.timeouts = timeouts;
  stats.fireTimeout = (ms) => {
    for (const [id, timer] of [...timeouts]) {
      if (timer.ms === ms) { timeouts.delete(id); timer.fn(); }
    }
  };
  const mocks = {
    react: React,
    'react-native': {
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      Platform: { OS: options.platform || 'ios' },
      StyleSheet: { create: (v) => v, absoluteFill: {} },
      Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
    },
    'expo-image': { Image: 'Image' },
    'expo-video': {
      VideoView: 'VideoView',
      useVideoPlayer: (_source, setup) => {
        const [player] = React.useState(() => {
          stats.created++;
          stats.sources.push(_source.uri);
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
      getImageCacheKey: (url) => url || '',
      isUnsupportedOnIOS: (url) => /\.webm(?:\?|$)/i.test(url),
    },
    '../utils/videoFallbackCache': {
      canUseExpoVideoCache: (url) => /^https?:\/\//i.test(String(url || '')) && !/\.m3u8/i.test(String(url || '')),
      recordCachedVideo: () => {},
    },
    '../utils/guards': { urlEndsWith: (url, ...extensions) =>
      typeof url === 'string' && extensions.some((ext) => url.split('?')[0].toLowerCase().endsWith(ext)) },
    '../services/proxyService': { proxyService: {
      hasWorker: () => !!options.worker,
      isProxiedUrl: (url) => url.startsWith('https://relay.test/'),
      forceProxyUrl: (url) => `https://relay.test/?url=${encodeURIComponent(url)}`,
    } },
    '../utils/imageLoadGate': { useLoadGate: () => [options.canLoad ?? true, release] },
    '../utils/freezeProbe': { trackGridPlayer: () => release, recordFreezeEvent: () => {} },
    '../utils/postIdentity': createLoader()(path.resolve(__dirname, '../src/utils/postIdentity.ts')),
    '../utils/gridPreviewMedia': createLoader()(path.resolve(__dirname, '../src/utils/gridPreviewMedia.ts')),
    '../utils/gridPreviews': {
      ...createLoader({ react: React }, { Date: class extends Date { static now() { return now; } } })(path.resolve(__dirname, '../src/utils/gridPreviews.ts')),
      useGridPreviewsEnabled: () => gridPreviewsOn,
    },
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
    setTimeout: options.fakeTimeouts ? (fn, ms) => {
      const id = ++timeoutId; timeouts.set(id, { fn, ms }); return id;
    } : setTimeout,
    clearTimeout: options.fakeTimeouts ? (id) => timeouts.delete(id) : clearTimeout,
    setInterval: (fn, ms) => {
      stats.lastInterval = ms;
      return setInterval(fn, ms);
    }, clearInterval,
  }, { filename });
  return { PostCard: module.exports.PostCard, stats };
}

function release() {}
function onPress() {}
// Per-test value of the preview toggle from Settings (default on).
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

test('favorite badge and memo updates use the post source as well as its remote ID', async () => {
  const { PostCard } = loadCard();
  const { getPostKey } = createLoader()(path.resolve(__dirname, '../src/utils/postIdentity.ts'));
  const post = { ...imagePost('42'), sourceId: 'b' };
  const props = { post, onPress, favoriteIds: new Set([getPostKey({ ...post, sourceId: 'a' })]) };
  await act(() => { root = create(React.createElement(PostCard, props)); });
  assert.equal(root.root.findAllByType('Heart').length, 0);
  await act(() => root.update(React.createElement(PostCard, { ...props, favoriteIds: new Set([getPostKey(post)]) })));
  assert.equal(root.root.findAllByType('Heart').length, 1);
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
  await act(() => root.root.findByType('TouchableOpacity').props.onLongPress());
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

test('frame slideshow advances with a relaxed 1200ms interval when focused and stays idle when unfocused', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...imagePost(), previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] };
  await act(() => { root = create(React.createElement(PostCard, { post, onPress, onScreen: true, videoActive: false })); });
  assert.equal(stats.lastInterval, undefined);
  await act(() => root.update(React.createElement(PostCard, { post, onPress, onScreen: true, videoActive: true })));
  assert.equal(stats.lastInterval, 1200);
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
  // Static cover stays: touch preview is not triggered either.
  await act(() => root.root.findByType('TouchableOpacity').props.onLongPress());
  assert.equal(stats.created, 0);
  assert.equal(root.root.findAllByType('VideoView').length, 0);
});

test('one broken video does not disable other clips on the same CDN', async () => {
  const { PostCard, stats } = loadCard();
  const propsA = { post: videoPost(), onPress, videoActive: true };
  await act(() => { root = create(React.createElement(PostCard, propsA)); });
  assert.equal(stats.created, 1);
  assert.equal(root.root.findAllByType('VideoView').length, 1);
  const callback = [...stats.listeners.values()][0];
  await act(() => callback({ status: 'error' }));
  assert.equal(root.root.findAllByType('VideoView').length, 0);
  // Only the failed URL is cooling down; another file on the same host still plays.
  const postB = { id: '2', previewUrl: 'https://cdn.test/2.jpg', previewVideoUrl: 'https://cdn.test/other.mp4', tags: {}, aspectRatio: 1 };
  await act(() => root.update(React.createElement(PostCard, { post: postB, onPress, videoActive: true })));
  assert.equal(stats.created, 2);
  assert.equal(root.root.findAllByType('VideoView').length, 1);
  assert.ok(root.root.findAllByType('Image').length >= 1);
});

const flattenStyle = (style) => Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : style || {};

test('cover stays above a loading video until the first frame, not merely readyToPlay', async () => {
  const { PostCard, stats } = loadCard();
  const props = { post: { ...videoPost(), sourceId: 'redgifs' }, onPress, videoActive: true };
  await act(async () => { root = create(React.createElement(PostCard, props)); });
  const cover = () => root.root.findByType('Image');
  assert.equal(flattenStyle(cover().props.style).opacity, 1);
  const childTypes = root.toJSON().children.map((child) => child.type);
  assert.ok(childTypes.indexOf('VideoView') < childTypes.indexOf('Image'));
  await act(async () => { [...stats.listeners.values()][0]({ status: 'readyToPlay' }); });
  assert.equal(flattenStyle(cover().props.style).opacity, 1);
  await act(async () => { root.root.findByType('VideoView').props.onFirstFrameRender(); });
  assert.equal(flattenStyle(cover().props.style).opacity, 0);
  await act(async () => root.update(React.createElement(PostCard, { ...props, videoActive: false })));
  assert.equal(flattenStyle(cover().props.style).opacity, 1);
  await act(async () => root.update(React.createElement(PostCard, props)));
  assert.equal(flattenStyle(cover().props.style).opacity, 1);
});

test('RedGifs thumbnail failure uses poster JPEG instead of handing MP4 to the image loader', async () => {
  const { PostCard, stats } = loadCard();
  const post = {
    ...imagePost(), sourceId: 'redgifs', previewFallbackUrl: 'https://cdn.test/poster.jpg',
    sampleUrl: 'https://cdn.test/mobile.mp4', originalUrl: 'https://cdn.test/full.mp4',
  };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress })); });
  await act(async () => root.root.findByType('Image').props.onError());
  assert.equal(root.root.findByType('Image').props.source.uri, 'https://cdn.test/poster.jpg');
  assert.equal(stats.created, 0);
});

test('failed image candidates never retry a video URL or loop between broken covers', async () => {
  const { PostCard } = loadCard();
  const post = {
    ...imagePost(), previewFallbackUrl: 'https://cdn.test/poster.jpg', sampleUrl: 'https://cdn.test/mobile.mp4',
  };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress })); });
  await act(async () => root.root.findByType('Image').props.onError());
  await act(async () => root.root.findByType('Image').props.onError());
  assert.equal(root.root.findByType('Image').props.source.uri, 'https://cdn.test/poster.jpg');
  assert.ok(root.root.findAllByType('Text').some((node) => node.props.children === 'Cover unavailable'));
});

test('cover retries use at most four distinct image URLs including a configured proxy', async () => {
  const { PostCard } = loadCard({ worker: true });
  const post = { ...imagePost(), previewFallbackUrl: 'https://cdn.test/poster.jpg', sampleUrl: 'https://cdn.test/mobile.mp4' };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress })); });
  const attempted = [];
  for (let i = 0; i < 4; i++) {
    const image = root.root.findByType('Image');
    attempted.push(image.props.source.uri);
    await act(async () => image.props.onError());
  }
  assert.equal(new Set(attempted).size, 4);
  assert.ok(attempted.every((url) => !url.includes('.mp4')));
  assert.equal(root.root.findByType('Image').props.source.uri, attempted[3]);
  assert.ok(root.root.findAllByType('Text').some((node) => node.props.children === 'Cover unavailable'));
});

test('booru MP4 sample previews play even without a dedicated previewVideoUrl field', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...imagePost(), sourceId: 'danbooru', sampleUrl: 'https://cdn.test/sample.mp4', fileExt: 'mp4' };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  assert.deepEqual(stats.sources, [post.sampleUrl]);
  assert.equal(root.root.findAllByType('Image').length, 1);
});

test('failed listing preview advances to a supplied sample with one live player', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...videoPost(), sampleUrl: 'https://cdn.test/sample.mp4' };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  await act(async () => [...stats.listeners.values()][0]({ status: 'error' }));
  assert.deepEqual(stats.sources, [post.previewVideoUrl, post.sampleUrl]);
  assert.equal(stats.live.size, 1);
});

test('a failed URL can retry after its cooldown without restarting the app', async () => {
  const { PostCard, stats } = loadCard();
  const props = { post: videoPost(), onPress, videoActive: true };
  await act(async () => { root = create(React.createElement(PostCard, props)); });
  await act(async () => [...stats.listeners.values()][0]({ status: 'error' }));
  assert.equal(stats.live.size, 0);
  stats.advance(30_001);
  await act(async () => root.update(React.createElement(PostCard, { ...props, videoActive: false })));
  await act(async () => root.update(React.createElement(PostCard, props)));
  assert.equal(stats.created, 2);
  assert.equal(stats.live.size, 1);
});

test('full-original-only video starts on hold, not automatic focus', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...imagePost(), originalUrl: 'https://cdn.test/full.mp4', fileExt: 'mp4' };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  assert.equal(stats.created, 0);
  await act(async () => root.root.findByType('TouchableOpacity').props.onLongPress());
  assert.deepEqual(stats.sources, [post.originalUrl]);
});

test('explicit off-screen visibility releases a still-focused player immediately', async () => {
  const { PostCard, stats } = loadCard();
  const props = { post: videoPost(), onPress, videoActive: true, onScreen: true };
  await act(async () => { root = create(React.createElement(PostCard, props)); });
  assert.equal(stats.live.size, 1);
  await act(async () => root.update(React.createElement(PostCard, { ...props, onScreen: false })));
  assert.equal(stats.live.size, 0);
});

test('failed slideshow frames are skipped; all failures return to the static cover', async () => {
  const { PostCard, stats } = loadCard();
  const post = { ...imagePost(), previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, onScreen: true, videoActive: true })); });
  const frame = () => root.root.findAllByType('Image').find((node) => node.props.recyclingKey?.startsWith('frame:'));
  assert.equal(frame().props.source.uri, post.previewThumbs[0]);
  await act(async () => frame().props.onError());
  assert.equal(frame().props.source.uri, post.previewThumbs[1]);
  await act(async () => frame().props.onError());
  assert.equal(root.root.findAllByType('Image').length, 1);
  assert.equal(stats.created, 0);
});

test('frame previews cannot bypass the image load gate', async () => {
  const { PostCard, stats } = loadCard({ canLoad: false });
  const post = { ...imagePost(), previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, onScreen: true, videoActive: true })); });
  assert.equal(root.root.findAllByType('Image').length, 0);
  assert.equal(stats.created, 0);
});

test('native readyToPlay without a first frame times out to cover/frame fallback', async () => {
  const { PostCard, stats } = loadCard({ fakeTimeouts: true });
  const post = { ...videoPost(), previewThumbs: ['https://cdn.test/1.jpg'] };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  await act(async () => [...stats.listeners.values()][0]({ status: 'readyToPlay' }));
  assert.equal(stats.live.size, 1);
  await act(async () => stats.fireTimeout(15_000));
  assert.equal(stats.live.size, 0);
  assert.equal(root.root.findAllByType('Image').length, 2);
});

test('first frame cancels the deadline, and card unmount clears its remaining timers', async () => {
  const { PostCard, stats } = loadCard({ fakeTimeouts: true });
  await act(async () => { root = create(React.createElement(PostCard, { post: videoPost(), onPress, videoActive: true })); });
  assert.ok([...stats.timeouts.values()].some((timer) => timer.ms === 15_000));
  await act(async () => root.root.findByType('VideoView').props.onFirstFrameRender());
  assert.ok(![...stats.timeouts.values()].some((timer) => timer.ms === 15_000));
  await act(async () => root.unmount()); root = undefined;
  assert.equal(stats.timeouts.size, 0);
});

test('memo distinguishes unspecified visibility from explicit off-screen suppression', async () => {
  const { PostCard, stats } = loadCard();
  const props = { post: videoPost(), onPress, videoActive: true };
  await act(async () => { root = create(React.createElement(PostCard, props)); });
  assert.equal(stats.live.size, 1);
  await act(async () => root.update(React.createElement(PostCard, { ...props, onScreen: false })));
  assert.equal(stats.live.size, 0);
});

test('grid cover images disable GIF autoplay, use normal priority, and skip GIF slideshow frames', async () => {
  const { PostCard } = loadCard();
  const post = { ...imagePost(), sampleUrl: 'https://cdn.test/sample.gif' };
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, videoActive: true })); });
  const images = root.root.findAllByType('Image');
  assert.equal(images.length, 1);
  assert.equal(images[0].props.autoplay, false);
  assert.equal(images[0].props.priority, 'normal');
});

test('isFavorite boolean prop controls favorite badge cleanly without Set scans', async () => {
  const { PostCard } = loadCard();
  const post = imagePost('77');
  await act(async () => { root = create(React.createElement(PostCard, { post, onPress, isFavorite: false })); });
  assert.equal(root.root.findAllByType('Heart').length, 0);
  await act(async () => root.update(React.createElement(PostCard, { post, onPress, isFavorite: true })));
  assert.equal(root.root.findAllByType('Heart').length, 1);
});

test('grid cover prefers crisp static sampleUrl over tiny previewUrl, but skips GIF and video sampleUrl', async () => {
  const { PostCard } = loadCard();
  const crispPost = { ...imagePost('10'), previewUrl: 'https://cdn.test/thumb_150.jpg', sampleUrl: 'https://cdn.test/sample_850.jpg' };
  await act(async () => { root = create(React.createElement(PostCard, { post: crispPost, onPress })); });
  assert.equal(root.root.findByType('Image').props.source.uri, 'https://cdn.test/sample_850.jpg');

  const gifPost = { ...imagePost('11'), previewUrl: 'https://cdn.test/thumb_150.jpg', sampleUrl: 'https://cdn.test/anim.gif' };
  await act(async () => root.update(React.createElement(PostCard, { post: gifPost, onPress })));
  assert.equal(root.root.findByType('Image').props.source.uri, 'https://cdn.test/thumb_150.jpg');
});

test('PostCard adapts fixed placeholder aspectRatio to real loaded cover dimensions (clamped 0.6–1.4) and caches it', async () => {
  const { PostCard } = loadCard();
  const realbooruPost = { ...imagePost('rb_42'), sourceId: 'realbooru', aspectRatio: 0.8 };
  await act(async () => {
    root = create(React.createElement(PostCard, { post: realbooruPost, onPress, columnWidth: 180 }));
  });
  const getHeight = () => root.root.findByType('TouchableOpacity').props.style[1].height;
  assert.equal(getHeight(), 180 / 0.8);

  // Landscape photo loads (1600x1000 -> ratio 1.6, clamped to 1.4 like Gelbooru masonry)
  await act(async () => {
    root.root.findByType('Image').props.onLoad({ source: { width: 1600, height: 1000 } });
  });
  assert.equal(getHeight(), 180 / 1.4);
});
