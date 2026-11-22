const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const roots = [];
afterEach(async () => { while (roots.length) await act(async () => roots.pop().unmount()); });
const preview = 'https://realbooru.com/thumbnails/65/d6/thumbnail_65d6d5876940b6a44981c2a014963d34.jpg';
const gif = 'https://realbooru.com/images/65/d6/65d6d5876940b6a44981c2a014963d34.gif';
const detail = 'https://realbooru.com/index.php?page=post&s=view&id=1011629';
const makePost = (extra = {}) => ({
  id: 'realbooru_1011629', sourceId: 'realbooru', sourceName: 'Realbooru',
  fileExt: 'gif', previewUrl: preview, sampleUrl: preview, originalUrl: gif,
  sourceLink: detail, tags: { general: ['animated', 'gif'], meta: [], artist: [], character: [], copyright: [] },
  allTags: ['animated', 'gif'], width: 800, height: 1000, ...extra,
});

async function setup(post, options = {}) {
  const calls = [];
  const proxyService = {
    proxyUrl: (u) => u, hasWorker: () => !!options.worker,
    isProxiedUrl: (u) => u.startsWith('https://relay.test/'),
    forceProxyUrl: (u) => `https://relay.test/?url=${encodeURIComponent(u)}`,
    fetchWithFallback: async (url, init) => {
      calls.push({ url, init });
      return options.response ? options.response(url, init) : {
        ok: true, text: async () => `<img id="image" src="${gif}" />`,
      };
    },
  };
  const media = createLoader({
    'react-native': { Platform: { OS: 'ios' } },
    '../services/proxyService': { proxyService },
    '../services/xvideos': {}, '../services/xhamster': {}, '../services/pornhub': {},
  })(path.resolve(__dirname, '../src/utils/media.ts'));
  const animation = () => ({ start: () => {} });
  const load = createLoader({
    react: React,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])),
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (v) => v },
      Animated: { Value: class { setValue() {} }, View: 'AnimatedView', timing: animation, spring: animation },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'ios' }, Alert: {}, Linking: {},
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    expo: {}, 'expo-file-system': {}, 'expo-image': { Image: 'Image' }, 'expo-video': {},
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    '../services/proxyService': { proxyService }, '../theme/colors': { Colors: { dark: {} } },
    '../services/storage': { StorageService: {
      isFavorite: async () => false, getImageQuality: async () => 'auto',
    } },
    './TagChip': {}, './PostInfoModal': { PostInfoModal: 'PostInfo' }, './PornhubWebViewResolver': {}, './WebmWebViewPlayer': {},
    '../utils/media': { ...media, resolveRealDimensions: async () => null },
    '../services/sexcom': {}, '../services/hentaihavens': {}, '../services/nhentai': {},
  }, { console: { ...console, warn() {} } });
  const Viewer = load(path.resolve(__dirname, '../src/components/ImageViewerModal.tsx')).ImageViewerModal;
  let outer, page;
  await act(async () => {
    outer = create(React.createElement(Viewer, {
      posts: [post], initialIndex: 0, visible: true, asScreen: true, onClose() {}, onTagPress() {},
    }));
  });
  roots.push(outer);
  // A host FlatList mock does not render items. Explicitly mount its actual
  // renderItem output so this exercises PostPageItem, not just the outer chrome.
  const item = outer.root.findByType('FlatList').props.renderItem({ item: post, index: 0 });
  await act(async () => { page = create(item); });
  roots.push(page);
  return { outer, page, calls, item };
}

test('fresh Realbooru GIF resolves detail even though original differs from sample; cover and animation mount', async () => {
  const { page, calls } = await setup(makePost());
  assert.equal(calls.length, 1, 'detail resolution must not be skipped');
  assert.equal(calls[0].url, detail);
  const images = page.root.findAllByType('Image');
  assert.equal(images[0].props.source.uri, preview);
  const animated = images.find((i) => i.props.source.uri === gif);
  assert.ok(animated);
  assert.equal(animated.props.source.isAnimated, true);
  assert.equal(animated.props.autoplay, true);
  assert.equal(animated.props.cachePolicy, 'disk');
  await act(async () => animated.props.onLoad());
  assert.equal(page.root.findAllByType('Image').find((i) => i.props.source.uri === gif).props.style.at(-1).opacity, 1);
});

test('old mp4 metadata cannot bypass detail resolution and the resulting GIF never mounts a player', async () => {
  const { page, calls } = await setup(makePost({ fileExt: 'mp4', originalUrl: gif.replace('.gif', '.mp4') }));
  assert.equal(calls.length, 1);
  assert.ok(page.root.findAllByType('Image').some((i) => i.props.source.uri === gif));
  assert.ok(page.root.findAllByType('Image').every((i) => !i.props.source.uri.endsWith('.mp4')));
});

test('Realbooru refreshes old split tags in the Info panel using the existing detail request', async () => {
  const post = makePost({ allTags: ['brown', 'eyes'], tags: { ...makePost().tags, general: ['brown', 'eyes'] } });
  const { outer, calls } = await setup(post, {
    response: async () => ({
      ok: true,
      text: async () => '<a class="tag-type-general" href="/index.php?page=post&amp;s=list&amp;tags=brown_eyes">brown eyes</a>' +
        '<a class="tag-type-general" href="/index.php?page=post&s=list&tags=blue+jacket">blue jacket</a>' +
        '<a href="/index.php?page=post&s=list&tags=unrelated">unrelated</a>',
    }),
  });
  const info = outer.root.findByType('PostInfo').props.post;
  assert.deepEqual(Array.from(info.tags.general), ['brown_eyes', 'blue_jacket']);
  assert.deepEqual(Array.from(info.allTags), ['brown_eyes', 'blue_jacket']);
  assert.equal(calls.length, 1);
});

test('GIF native failure retries once through configured worker, then shows the actual error', async () => {
  const { page } = await setup(makePost(), { worker: true });
  let animated = () => page.root.findAllByType('Image').find((i) => i.props.source.isAnimated);
  await act(async () => animated().props.onError({ error: 'TLS failed' }));
  assert.ok(animated().props.source.uri.startsWith('https://relay.test/'));
  await act(async () => animated().props.onError({ error: 'HTTP 403' }));
  assert.equal(animated(), undefined);
  assert.ok(page.root.findAllByType('Text').some((n) => n.props.children === 'HTTP 403'));
  const retry = page.root.findAllByType('TouchableOpacity').find((b) => b.findAllByType('Text').some((n) => n.props.children === 'Retry'));
  await act(async () => retry.props.onPress());
  assert.ok(animated());
});

test('leaving the active page unmounts the large animation but keeps its thumbnail', async () => {
  const { page, item } = await setup(makePost());
  await act(async () => page.update(React.cloneElement(item, { isActive: false })));
  assert.equal(page.root.findAllByType('Image').length, 1);
  assert.equal(page.root.findByType('Image').props.source.uri, preview);
});
