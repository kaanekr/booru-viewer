const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { setupSettings } = require('./helpers/settings-screen.cjs');

global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => {
  if (root) await act(() => root.unmount());
  root = undefined;
});

function createFakeFileSystem() {
  const files = new Map();
  const norm = (p) => String(p).replace(/\/+/g, '/').replace(/\/$/, '');

  class FakeFile {
    constructor(...parts) {
      const joined = parts
        .map((part) => (typeof part === 'string' ? part : part?.uri || ''))
        .filter(Boolean)
        .join('/');
      this.uri = norm(joined);
      this.name = this.uri.split('/').pop() || '';
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      const entry = files.get(this.uri);
      return entry ? entry.size : 0;
    }
    write(content) {
      const text = String(content);
      files.set(this.uri, { content: text, size: Buffer.byteLength(text, 'utf8') });
    }
    textSync() {
      const entry = files.get(this.uri);
      if (!entry) throw new Error(`ENOENT: ${this.uri}`);
      return entry.content;
    }
    async text() {
      return this.textSync();
    }
    delete() {
      files.delete(this.uri);
    }
    static async downloadFileAsync(url, target) {
      const size = FakeFile.nextDownloadSize ?? 1024;
      files.set(target.uri, { content: `video:${url}`, size });
      return target;
    }
  }
  FakeFile.nextDownloadSize = 1024;

  class FakeDirectory {
    constructor(...parts) {
      const joined = parts
        .map((part) => (typeof part === 'string' ? part : part?.uri || ''))
        .filter(Boolean)
        .join('/');
      this.uri = norm(joined);
    }
    create() {}
    list() {
      const prefix = `${this.uri}/`;
      const out = [];
      for (const uri of files.keys()) {
        if (!uri.startsWith(prefix)) continue;
        const rest = uri.slice(prefix.length);
        if (!rest.includes('/')) out.push(new FakeFile(uri));
      }
      return out;
    }
  }

  return {
    files,
    module: {
      File: FakeFile,
      Directory: FakeDirectory,
      Paths: { cache: 'file:///cache' },
    },
  };
}

test('LruCache evicts least-recently-used entries, respects TTL, and deduplicates concurrent async calls', async () => {
  const load = createLoader();
  const { LruCache, getOrDedup } = load(path.resolve(__dirname, '../src/utils/lruCache.ts'));

  const cache = new LruCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1); // 'a' becomes most-recently-used
  cache.set('c', 3); // evicts 'b'
  assert.equal(cache.has('b'), false);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);

  // Per-entry TTL (e.g. negative cache TTL)
  const ttlCache = new LruCache(5);
  ttlCache.set('neg', null, 15);
  assert.equal(ttlCache.has('neg'), true);
  assert.equal(ttlCache.get('neg'), null);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ttlCache.has('neg'), false);
  assert.equal(ttlCache.get('neg'), undefined);

  // In-flight deduplication
  const inflight = new Map();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 15));
    return 'resolved-value';
  };
  const [r1, r2, r3] = await Promise.all([
    getOrDedup(inflight, 'k1', loader),
    getOrDedup(inflight, 'k1', loader),
    getOrDedup(inflight, 'k1', loader),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual([r1, r2, r3], ['resolved-value', 'resolved-value', 'resolved-value']);
  assert.equal(inflight.size, 0);
});

test('getImageCacheKey unwraps proxy Worker URLs and strips ephemeral auth/expiry params', () => {
  const load = createLoader({
    'react-native': {
      Platform: { OS: 'ios' },
      Image: { getSizeWithHeaders() {}, getSize() {} },
    },
    './lruCache': createLoader()(path.resolve(__dirname, '../src/utils/lruCache.ts')),
    '../services/proxyService': {
      proxyService: {
        getConfig: () => ({ enabled: false, workerUrl: '' }),
        getProxiedUrl: (u) => u,
        isProxyEnabled: () => false,
      },
    },
    '../services/sources': { AVAILABLE_SOURCES: [] },
  });
  const { getImageCacheKey } = load(path.resolve(__dirname, '../src/utils/media.ts'));

  const direct = 'https://cdn.example.com/images/42.jpg?id=42&expires=1700000000&signature=abc123&token=xyz';
  const proxied = `https://my-worker.workers.dev/?url=${encodeURIComponent(direct)}`;
  const freshToken = 'https://cdn.example.com/images/42.jpg?id=42&expires=1999999999&signature=zzz999&token=new';

  const kDirect = getImageCacheKey(direct);
  const kProxied = getImageCacheKey(proxied);
  const kFresh = getImageCacheKey(freshToken);

  assert.equal(kDirect, kProxied);
  assert.equal(kDirect, kFresh);
  assert.match(kDirect, /id=42/);
  assert.doesNotMatch(kDirect, /expires=|signature=|token=/);
});

test('listCache serves fresh/stale SWR entries, tracks stats, and clears memory and disk', async () => {
  const fs = createFakeFileSystem();
  let cacheLimitMb = 512;
  const load = createLoader({
    'expo-file-system': fs.module,
    './lruCache': createLoader()(path.resolve(__dirname, '../src/utils/lruCache.ts')),
    '../services/storage': {
      DEFAULT_CACHE_LIMIT_MB: 512,
      StorageService: {
        getCacheLimitMb: async () => cacheLimitMb,
      },
    },
  });
  const listCache = load(path.resolve(__dirname, '../src/utils/listCache.ts'));

  const keyA = listCache.buildListCacheKey('feed', 'danbooru', 'cat', 'sort:latest', 1);
  const postsA = [{ id: '1', sourceId: 'danbooru', previewUrl: 'https://cdn.test/1.jpg' }];
  await listCache.setListCache(keyA, postsA, 60_000);

  const freshHit = await listCache.getListCache(keyA);
  assert.ok(freshHit);
  assert.equal(freshHit.stale, false);
  assert.equal(freshHit.posts.length, 1);

  // Stale hit when entry TTL is short and expires (still within 24h max stale)
  const keyB = listCache.buildListCacheKey('search', 'danbooru', 'dog', 'sort:score', 1);
  await listCache.setListCache(keyB, postsA, 10);
  await new Promise((r) => setTimeout(r, 25));
  const staleHit = await listCache.getListCache(keyB);
  assert.ok(staleHit);
  assert.equal(staleHit.stale, true);

  // Stats report stored bytes & entries
  const stats = listCache.getListCacheStats();
  assert.equal(stats.entries, 2);
  assert.ok(stats.bytes > 0);

  // Clear removes both memory and disk entries
  await listCache.clearListCache();
  assert.equal(listCache.getListCacheStats().entries, 0);
  const afterClear = await listCache.getListCache(keyA);
  assert.equal(afterClear, null);
});

test('videoFallbackCache evicts least-recently-used videos by byte budget and reacts to manual limit changes', async () => {
  const fs = createFakeFileSystem();
  let cacheLimitMb = 100; // video budget = max(50, round(100 * 0.6)) = 60 MB
  const load = createLoader({
    'expo-file-system': fs.module,
    '../services/storage': {
      DEFAULT_CACHE_LIMIT_MB: 512,
      StorageService: {
        getCacheLimitMb: async () => cacheLimitMb,
      },
    },
  });
  const videoCache = load(path.resolve(__dirname, '../src/utils/videoFallbackCache.ts'));

  const MB = 1024 * 1024;
  const controller = new AbortController();
  fs.module.File.nextDownloadSize = 25 * MB;
  await videoCache.downloadVideoViaAppSession('https://cdn.test/v1.mp4', {}, controller.signal);
  await new Promise((r) => setTimeout(r, 10));
  await videoCache.downloadVideoViaAppSession('https://cdn.test/v2.mp4', {}, controller.signal);
  await new Promise((r) => setTimeout(r, 10));

  // Touch v1 so v2 becomes the least-recently-used video
  await videoCache.downloadVideoViaAppSession('https://cdn.test/v1.mp4', {}, controller.signal);
  await new Promise((r) => setTimeout(r, 10));

  // Adding v3 (25 MB) pushes total to 75 MB > 60 MB budget -> must evict v2, keeping v1 and v3
  await videoCache.downloadVideoViaAppSession('https://cdn.test/v3.mp4', {}, controller.signal);

  const statsAfterThird = videoCache.getVideoCacheStats();
  assert.equal(statsAfterThird.files, 2);
  assert.equal(statsAfterThird.bytes, 50 * MB);

  // Shrinking manual limit further via enforceVideoCacheLimit evicts oldest down to budget
  // (minimum video budget is 50 MB, so 2 files * 25 MB = 50 MB fits; clearing frees all)
  await videoCache.clearVideoCache();
  assert.equal(videoCache.getVideoCacheStats().files, 0);
  assert.equal(videoCache.getVideoCacheStats().bytes, 0);
});

test('StorageService persists clamped cacheLimitMb and serves O(1) isFavorite in sync with updates', async () => {
  const store = new Map();
  let getItemCalls = 0;
  const asyncStorageMock = {
    getItem: async (k) => {
      getItemCalls += 1;
      return store.has(k) ? store.get(k) : null;
    },
    setItem: async (k, v) => {
      store.set(k, v);
    },
    removeItem: async (k) => {
      store.delete(k);
    },
    multiGet: async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
    multiRemove: async (keys) => keys.forEach((k) => store.delete(k)),
  };

  const load = createLoader({
    '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorageMock },
    '../utils/media': {
      hasUsableMediaUrl: (u) => Boolean(u),
      isVideoPost: () => false,
    },
  });
  const {
    StorageService,
    DEFAULT_CACHE_LIMIT_MB,
    MIN_CACHE_LIMIT_MB,
    MAX_CACHE_LIMIT_MB,
  } = load(path.resolve(__dirname, '../src/services/storage.ts'));

  // Default & clamping
  assert.equal(await StorageService.getCacheLimitMb(), DEFAULT_CACHE_LIMIT_MB);
  assert.equal(await StorageService.setCacheLimitMb(10), MIN_CACHE_LIMIT_MB);
  assert.equal(await StorageService.getCacheLimitMb(), MIN_CACHE_LIMIT_MB);
  assert.equal(await StorageService.setCacheLimitMb(99999), MAX_CACHE_LIMIT_MB);
  assert.equal(await StorageService.getCacheLimitMb(), MAX_CACHE_LIMIT_MB);
  assert.equal(await StorageService.setCacheLimitMb(1024), 1024);
  assert.equal(await StorageService.getCacheLimitMb(), 1024);

  // O(1) favorites index: prime once, subsequent isFavorite calls do not re-read AsyncStorage
  const samplePost = { id: 'p1', sourceId: 'danbooru', previewUrl: 'https://cdn.test/p1.jpg', fileUrl: 'https://cdn.test/p1.jpg', tags: {} };
  await StorageService.toggleFavorite(samplePost);
  const readsAfterToggle = getItemCalls;
  assert.equal(await StorageService.isFavorite({ id: 'p1', sourceId: 'danbooru' }), true);
  assert.equal(await StorageService.isFavorite({ id: 'p2', sourceId: 'danbooru' }), false);
  assert.equal(getItemCalls, readsAfterToggle);

  // Unfavorite keeps index in sync
  await StorageService.toggleFavorite(samplePost);
  assert.equal(await StorageService.isFavorite({ id: 'p1', sourceId: 'danbooru' }), false);
});

test('SettingsScreen Storage & backup lets user pick preset, enter custom MB limit, reject invalid values, and clear individual caches', async () => {
  const { Screen, cacheLimitWrites, cacheClears, alerts } = setupSettings({ cacheLimitMb: 512 });
  await act(async () => {
    root = create(React.createElement(Screen));
  });

  // Navigate to Storage & backup page
  const storageRow = root.root.findByProps({ accessibilityLabel: 'Storage & backup' });
  await act(async () => storageRow.props.onPress());

  // 1. Select preset 1 GB (1024 MB)
  const preset1Gb = root.root.findByProps({ accessibilityLabel: 'Cache limit 1 GB' });
  await act(async () => preset1Gb.props.onPress());
  assert.deepEqual(cacheLimitWrites, [1024]);

  // 2. Enter custom limit 750 MB and save
  const customInput = root.root.findByProps({ accessibilityLabel: 'Custom cache size MB' });
  await act(async () => customInput.props.onChangeText('750'));
  const saveLimitBtn = root.root.findByProps({ accessibilityLabel: 'Save limit' });
  await act(async () => saveLimitBtn.props.onPress());
  assert.deepEqual(cacheLimitWrites, [1024, 750]);

  // 3. Reject out-of-range custom input (20 MB < 50 MB minimum)
  await act(async () => customInput.props.onChangeText('20'));
  await act(async () => saveLimitBtn.props.onPress());
  assert.deepEqual(cacheLimitWrites, [1024, 750]);
  assert.ok(alerts.some((a) => String(a[0]).includes('Invalid cache size')));

  // Helper to confirm the latest Alert dialog's destructive/Clear button
  const confirmLatestAlert = async () => {
    const latest = alerts[alerts.length - 1];
    const buttons = Array.isArray(latest?.[2]) ? latest[2] : [];
    const confirmBtn = buttons.find((b) => b.style === 'destructive' || /clear/i.test(String(b.text)));
    assert.ok(confirmBtn && typeof confirmBtn.onPress === 'function');
    await act(async () => confirmBtn.onPress());
  };

  // 4. Granular cache clear actions (each opens a confirmation Alert)
  const clearImageRow = root.root.findByProps({ accessibilityLabel: 'Clear image cache' });
  await act(async () => clearImageRow.props.onPress());
  await confirmLatestAlert();
  assert.ok(cacheClears.includes('image-disk'));
  assert.ok(cacheClears.includes('image-mem'));

  const clearVideoRow = root.root.findByProps({ accessibilityLabel: 'Clear video cache' });
  await act(async () => clearVideoRow.props.onPress());
  await confirmLatestAlert();
  assert.ok(cacheClears.includes('video'));

  const clearApiRow = root.root.findByProps({ accessibilityLabel: 'Clear list & API cache' });
  await act(async () => clearApiRow.props.onPress());
  await confirmLatestAlert();
  assert.ok(cacheClears.includes('list'));
  assert.ok(cacheClears.includes('resolve'));
  assert.ok(cacheClears.includes('posts'));
});

test('canUseExpoVideoCache enables caching for direct/proxied MP4s, disables for HLS/DASH/file, and syncs native expo-video cache', async () => {
  const fs = createFakeFileSystem();
  let nativeSizeBytes = 12 * 1024 * 1024;
  const setSizeCalls = [];
  let clearCalls = 0;

  const load = createLoader({
    'expo-file-system': fs.module,
    'expo-video': {
      setVideoCacheSizeAsync: async (bytes) => { setSizeCalls.push(bytes); },
      getCurrentVideoCacheSize: () => nativeSizeBytes,
      clearVideoCacheAsync: async () => { clearCalls += 1; nativeSizeBytes = 0; },
    },
    '../services/storage': {
      DEFAULT_CACHE_LIMIT_MB: 512,
      StorageService: {
        getCacheLimitMb: async () => 500,
      },
    },
  });
  const videoCache = load(path.resolve(__dirname, '../src/utils/videoFallbackCache.ts'));

  // Direct MP4 / MOV / proxied MP4 -> cacheable
  assert.equal(videoCache.canUseExpoVideoCache('https://api-cdn-mp4.rule34.xxx/images/1/a.mp4'), true);
  assert.equal(videoCache.canUseExpoVideoCache('https://media.redgifs.com/FooBar.mp4'), true);
  assert.equal(
    videoCache.canUseExpoVideoCache(`https://my-worker.workers.dev/?url=${encodeURIComponent('https://realbooru.com/images/1/a.mp4')}`),
    true
  );

  // HLS / DASH / proxied HLS / local file -> NOT cacheable via expo-video
  assert.equal(videoCache.canUseExpoVideoCache('https://cdn.test/video/master.m3u8?token=abc'), false);
  assert.equal(
    videoCache.canUseExpoVideoCache(`https://my-worker.workers.dev/?url=${encodeURIComponent('https://cdn.test/video/master.m3u8')}`),
    false
  );
  assert.equal(videoCache.canUseExpoVideoCache('https://cdn.test/video/manifest.mpd'), false);
  assert.equal(videoCache.canUseExpoVideoCache('file:///cache/video-fallback/v_123.mp4'), false);
  assert.equal(videoCache.canUseExpoVideoCache(''), false);

  // Native expo-video cache size is included in getVideoCacheStats and synced via enforceVideoCacheLimit
  videoCache.recordCachedVideo('https://api-cdn-mp4.rule34.xxx/images/1/a.mp4');
  videoCache.recordCachedVideo('https://api-cdn-mp4.rule34.xxx/images/1/a.mp4'); // deduplicated
  videoCache.recordCachedVideo('https://media.redgifs.com/FooBar.mp4');
  videoCache.recordCachedVideo('https://cdn.test/video/master.m3u8'); // HLS ignored
  assert.deepEqual({ ...videoCache.getVideoCacheStats() }, { bytes: 12 * 1024 * 1024, files: 2 });
  await videoCache.enforceVideoCacheLimit(500); // 60% of 500 MB = 300 MB
  assert.deepEqual(setSizeCalls, [300 * 1024 * 1024]);

  // clearVideoCache also clears native expo-video cache and tracked video count
  await videoCache.clearVideoCache();
  assert.equal(clearCalls, 1);
  assert.deepEqual({ ...videoCache.getVideoCacheStats() }, { bytes: 0, files: 0 });
});

test('the optional iOS HLS module opens Worker-wrapped playlists and shares existing cache controls', async () => {
  const fs = createFakeFileSystem();
  const calls = [];
  const session = { id: 'a1', uri: 'http://127.0.0.1:30001/a1/master.m3u8' };
  const native = {
    open: async (...args) => { calls.push(['open', ...args]); return session; },
    setLimit: async (size) => { calls.push(['limit', size]); },
    close: async (id) => { calls.push(['close', id]); },
    stats: async () => ({ bytes: 8192, files: 1 }),
    clear: async () => { calls.push(['clear']); },
  };
  const load = createLoader({
    'expo-file-system': fs.module,
    expo: { requireOptionalNativeModule: (name) => name === 'BooruHlsCache' ? native : null },
    'expo-video': { setVideoCacheSizeAsync: async (size) => { calls.push(['progressive', size]); } },
    '../services/storage': { DEFAULT_CACHE_LIMIT_MB: 512, StorageService: { getCacheLimitMb: async () => 500 } },
  });
  const cache = load(path.resolve(__dirname, '../src/utils/videoFallbackCache.ts'));
  const playlist = 'https://ev.phncdn.com/hls/test/master.m3u8';
  const wrapped = 'https://relay.example.com/?url=' + encodeURIComponent(playlist);
  const headers = { Referer: 'https://www.pornhub.com/' };
  assert.equal(await cache.openHlsCachePlayback('https://ev.phncdn.com/test.mp4', 'ph:1', headers), null);
  assert.equal(await cache.openHlsCachePlayback(wrapped, 'ph:1', headers), session);
  assert.deepEqual(calls[0], ['open', wrapped, 'ph:1', headers, 150 * 1024 * 1024]);
  cache.closeHlsCachePlayback(session.id);
  assert.deepEqual(calls[1], ['close', 'a1']);
  assert.deepEqual({ ...(await cache.getHlsVideoCacheStats()) }, { bytes: 8192, files: 1 });
  await cache.enforceVideoCacheLimit(500);
  assert.deepEqual(calls.slice(2), [['progressive', 75 * 1024 * 1024], ['limit', 150 * 1024 * 1024]]);
  await cache.clearVideoCache();
  assert.deepEqual(calls.at(-1), ['clear']);
});

test('Expo Go can keep playing the original HLS URL without the optional module', async () => {
  const load = createLoader({ 'expo-file-system': {}, '../services/storage': {}, expo: { requireOptionalNativeModule: () => null } });
  const cache = load(path.resolve(__dirname, '../src/utils/videoFallbackCache.ts'));
  const hls = 'https://ev.phncdn.com/hls/test/master.m3u8';
  assert.equal(await cache.openHlsCachePlayback(hls, 'ph:1', {}), null);
  assert.equal(cache.canUseExpoVideoCache(hls), false);
  assert.deepEqual({ ...(await cache.getHlsVideoCacheStats()) }, { bytes: 0, files: 0 });
});

test('parseImageHeaderDimensions and enrichPostAspectRatios parse JPEG/PNG/GIF headers via Range and cache results', async () => {
  // Minimal valid JPEG SOF0 (width=640, height=480)
  const jpegBytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 (len=4)
    0xff, 0xc0, 0x00, 0x0b, 0x08, // SOF0, len=11, precision=8
    0x01, 0xe0, // height = 480
    0x02, 0x80, // width = 640
    0x03, 0x01, 0x11, 0x00,
  ]);
  // Minimal PNG IHDR (width=1000, height=1500)
  const pngBytes = new Uint8Array(24);
  pngBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(pngBytes.buffer).setUint32(16, 1000, false);
  new DataView(pngBytes.buffer).setUint32(20, 1500, false);
  // Minimal GIF89a (width=320, height=240)
  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);

  let fetchCalls = 0;
  const load = createLoader({
    './lruCache': createLoader()(path.resolve(__dirname, '../src/utils/lruCache.ts')),
    '../services/proxyService': {
      proxyService: {
        fetchWithFallback: async (url, init) => {
          fetchCalls += 1;
          assert.equal(init.headers.Range, 'bytes=0-4095');
          const payload = url.endsWith('.png') ? pngBytes : jpegBytes;
          return { ok: true, status: 206, arrayBuffer: async () => payload.buffer };
        },
      },
    },
  });
  const { parseImageHeaderDimensions, enrichPostAspectRatios } = load(
    path.resolve(__dirname, '../src/utils/imageDimensions.ts')
  );

  assert.deepEqual({ ...parseImageHeaderDimensions(jpegBytes) }, { width: 640, height: 480 });
  assert.deepEqual({ ...parseImageHeaderDimensions(pngBytes) }, { width: 1000, height: 1500 });
  assert.deepEqual({ ...parseImageHeaderDimensions(gifBytes) }, { width: 320, height: 240 });

  const posts = [
    { id: '1', previewUrl: 'https://realbooru.com/thumbnails/a/b/t1.jpg', width: 800, height: 1000, aspectRatio: 0.8 },
    { id: '2', previewUrl: 'https://realbooru.com/thumbnails/a/b/t2.png', width: 800, height: 1000, aspectRatio: 0.8 },
  ];
  await enrichPostAspectRatios(posts, 'https://realbooru.com/');
  assert.equal(posts[0].width, 640);
  assert.equal(posts[0].height, 480);
  assert.equal(posts[0].aspectRatio, 640 / 480);
  assert.equal(posts[1].width, 1000);
  assert.equal(posts[1].height, 1500);
  assert.equal(fetchCalls, 2);

  // Second call for same URLs hits HEADER_DIMS_CACHE without network requests
  await enrichPostAspectRatios(posts, 'https://realbooru.com/');
  assert.equal(fetchCalls, 2);
});
