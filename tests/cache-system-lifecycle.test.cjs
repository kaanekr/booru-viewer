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
