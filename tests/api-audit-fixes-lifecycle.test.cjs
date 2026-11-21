const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

const SRC = path.resolve(__dirname, '../src');

// 1. RedGifs & Cum.st apply user tag blacklists (and respect includeBlacklisted)
test('RedGifs and Cum.st feeds filter blacklisted tags, niches, and creators unless includeBlacklisted is true', async () => {
  const blacklisted = ['banned_tag', 'niche:blocked-niche', 'user:badcreator'];
  const load = createLoader({
    '@react-native-async-storage/async-storage': {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    './storage': {
      StorageService: {
        getBlacklistedTags: async () => blacklisted,
        getRedGifsTokenCache: async () => null,
        setRedGifsTokenCache: async () => {},
      },
    },
    './proxyService': {
      proxyService: {
        ensureInitialized: async () => {},
        isEnabled: () => false,
        getWorkerUrl: () => '',
        fetchWithFallback: async (url) => {
          if (String(url).includes('cum.st/api/v1/posts')) {
            return new Response(
              JSON.stringify({
                posts: [
                  {
                    id: '1',
                    creatorName: 'good',
                    service: 'onlyfans',
                    tags: ['safe_tag'],
                    attachments: [{ sha256: 'aaa', kind: 'image', originalFilename: 'a.jpg', width: 800, height: 800 }],
                  },
                  {
                    id: '2',
                    creatorName: 'other',
                    service: 'onlyfans',
                    tags: ['banned_tag'],
                    attachments: [{ sha256: 'bbb', kind: 'image', originalFilename: 'b.jpg', width: 800, height: 800 }],
                  },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response('{}', { status: 404 });
        },
      },
    },
  });

  const { BooruApiService } = load(path.join(SRC, 'services/booruApi.ts'));
  const api = new BooruApiService();

  // Stub RedGifs transport
  api.fetchRedGifsApi = async (url) => {
    if (String(url).includes('/auth/temporary')) {
      return new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        gifs: [
          { id: 'ok1', tags: ['cute'], niches: ['good-niche'], userName: 'alice', urls: { hd: 'https://x/1.mp4', thumbnail: 'https://x/1.jpg' } },
          { id: 'badTag', tags: ['banned_tag'], niches: [], userName: 'alice', urls: { hd: 'https://x/2.mp4', thumbnail: 'https://x/2.jpg' } },
          { id: 'badNiche', tags: ['cute'], niches: ['blocked-niche'], userName: 'alice', urls: { hd: 'https://x/3.mp4', thumbnail: 'https://x/3.jpg' } },
          { id: 'badUser', tags: ['cute'], niches: [], userName: 'badcreator', urls: { hd: 'https://x/4.mp4', thumbnail: 'https://x/4.jpg' } },
        ],
      }),
      { status: 200 }
    );
  };

  const redgifs = { id: 'redgifs', name: 'RedGifs', baseUrl: 'https://api.redgifs.com', type: 'redgifs' };
  const rgFiltered = await api.fetchPosts(1, 20, '', undefined, redgifs);
  assert.deepEqual(Array.from(rgFiltered.map((p) => p.id)), ['rg_ok1']);

  const rgIncluded = await api.fetchPosts(1, 20, '', { tags: [], sortBy: 'default', timeRange: 'all', rating: 'all', includeBlacklisted: true }, redgifs);
  assert.equal(rgIncluded.length, 4);

  const cumst = { id: 'cumst', name: 'Cum.st', baseUrl: 'https://cum.st', type: 'cumst' };
  const csFiltered = await api.fetchPosts(1, 20, '', undefined, cumst);
  assert.deepEqual(Array.from(csFiltered.map((p) => p.id)), ['cumst_1']);

  const csIncluded = await api.fetchPosts(1, 20, '', { tags: [], sortBy: 'default', timeRange: 'all', rating: 'all', includeBlacklisted: true }, cumst);
  assert.equal(csIncluded.length, 2);
});

// 2. proxyService.fetchWithTimeout aborts underlying fetch on timeout even with caller AbortSignal
test('proxyService.fetchWithTimeout aborts underlying fetch signal on timeout when caller passes AbortSignal', async () => {
  let seenSignal = null;
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on('unhandledRejection', onUnhandled);

  try {
    const load = createLoader(
      {
        './storage': {
          StorageService: {
            getProxyConfig: async () => ({ enabled: false, workerUrl: '' }),
            setProxyConfig: async () => {},
          },
        },
      },
      {
        fetch: (_url, init) => {
          seenSignal = init.signal;
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              // Reject on a later macrotask to verify no unhandledRejection fires
              setTimeout(() => reject(new Error('late socket abort')), 10);
            });
          });
        },
      }
    );

    const { proxyService } = load(path.join(SRC, 'services/proxyService.ts'));
    await proxyService.ensureInitialized();

    const callerCtrl = new AbortController();
    await assert.rejects(
      () => proxyService.fetchWithFallback('https://example.com/slow', { signal: callerCtrl.signal }, 25),
      /timeout/i
    );

    assert.ok(seenSignal, 'fetch must receive a signal');
    assert.notEqual(seenSignal, callerCtrl.signal, 'fetch should receive internal controller signal');
    assert.equal(seenSignal.aborted, true, 'underlying fetch signal must be aborted on timeout');
    assert.equal(callerCtrl.signal.aborted, false, 'caller signal must remain untouched');

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(unhandled, null, 'orphaned fetch rejection must not cause unhandledRejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

// 3. Backup re-import does not pollute favoriteTags with plain searchHistory strings
test('backupService.parseAnimeBoxesBackup does not copy plain string searchHistory into starredTags', () => {
  const load = createLoader({
    'react-native': { Platform: { OS: 'ios' } },
    'expo-file-system': { File: class {}, Paths: {} },
    'expo-document-picker': {},
    'expo-sharing': {},
    './storage': { StorageService: {} },
    './sources': { BOORU_SOURCES: [] },
    './booruApi': { booruApi: {} },
  });

  const { BackupService } = load(path.join(SRC, 'services/backupService.ts'));

  // Our own export format: searchHistory is string[], favoriteTags is string[]
  const ownExport = {
    favorites: [],
    searchHistory: ['random_query_1', 'random_query_2'],
    favoriteTags: ['my_fav_tag'],
    blacklistedTags: ['bad_tag'],
  };
  const parsedOwn = BackupService.parseAnimeBoxesBackup(ownExport);
  assert.deepEqual(Array.from(parsedOwn.searchHistory), ['random_query_1', 'random_query_2']);
  assert.deepEqual(Array.from(parsedOwn.starredTags), ['my_fav_tag']);

  // Legacy AnimeBoxes format: searchHistory has objects with { searchText, starred }
  const legacyExport = {
    favorites: [],
    searchHistory: [
      { searchText: 'Starred_Tag', starred: true },
      { searchText: 'Normal_Query', starred: false },
    ],
  };
  const parsedLegacy = BackupService.parseAnimeBoxesBackup(legacyExport);
  assert.deepEqual(Array.from(parsedLegacy.starredTags), ['starred_tag']);
  assert.deepEqual(Array.from(parsedLegacy.searchHistory), ['starred_tag', 'normal_query']);
});

// 4. StorageService atomic favorites cache, default cacheLimitMb caching, and blacklistedTags memory cache
test('StorageService updates favorites cache inside queueWrite, caches default cacheLimitMb, and caches blacklistedTags', async () => {
  const store = new Map();
  let getItemCounts = new Map();
  const asyncStorage = {
    getItem: async (k) => {
      getItemCounts.set(k, (getItemCounts.get(k) || 0) + 1);
      return store.has(k) ? store.get(k) : null;
    },
    setItem: async (k, v) => {
      // Simulate async delay so concurrent readers await pendingWrites
      await new Promise((r) => setTimeout(r, 15));
      store.set(k, v);
    },
    removeItem: async (k) => {
      store.delete(k);
    },
  };

  const load = createLoader({
    '@react-native-async-storage/async-storage': asyncStorage,
  });
  const { StorageService, DEFAULT_CACHE_LIMIT_MB } = load(path.join(SRC, 'services/storage.ts'));

  // Default cache limit should only hit AsyncStorage once when unconfigured
  const l1 = await StorageService.getCacheLimitMb();
  const l2 = await StorageService.getCacheLimitMb();
  assert.equal(l1, DEFAULT_CACHE_LIMIT_MB);
  assert.equal(l2, DEFAULT_CACHE_LIMIT_MB);
  assert.equal(getItemCounts.get('@booru_cache_limit_mb_v1'), 1);

  // Favorites: prime cache, then start a write and concurrently read
  assert.deepEqual(Array.from(await StorageService.getFavorites()), []);
  const postA = { id: '101', sourceId: 'danbooru' };
  const writePromise = StorageService.saveAllFavorites([postA]);
  const concurrentFavs = await StorageService.getFavorites();
  const concurrentIsFav = await StorageService.isFavorite(postA);
  await writePromise;

  assert.equal(concurrentFavs.length, 1);
  assert.equal(concurrentFavs[0].id, '101');
  assert.equal(concurrentIsFav, true);

  // Mutating returned favorites array must not corrupt internal cache
  concurrentFavs.pop();
  assert.equal((await StorageService.getFavorites()).length, 1);

  // Blacklisted tags memory cache + invalidation
  assert.deepEqual(Array.from(await StorageService.getBlacklistedTags()), []);
  assert.deepEqual(Array.from(await StorageService.getBlacklistedTags()), []);
  assert.equal(getItemCounts.get('@booru_blacklisted_tags_v2'), 1);

  await StorageService.addBlacklistedTag('guro');
  assert.deepEqual(Array.from(await StorageService.getBlacklistedTags()), ['guro']);
  assert.equal(getItemCounts.get('@booru_blacklisted_tags_v2'), 2); // 1 initial read + 1 inside updateList

  await StorageService.clearBlacklistedTags();
  assert.deepEqual(Array.from(await StorageService.getBlacklistedTags()), []);
});

// 5. videoFallbackCache deletes partial file on download failure and caps nativeTrackedKeys at 500
test('videoFallbackCache cleans up partial file on failed download and caps nativeTrackedKeys at 500', async () => {
  const files = new Map();
  let shouldFail = true;

  class MockFile {
    constructor(dir, name) {
      this.name = name;
      this.uri = `file:///cache/booru-videos/${name}`;
    }
    get exists() {
      return files.has(this.name);
    }
    get size() {
      const v = files.get(this.name);
      return v ? v.length : 0;
    }
    textSync() {
      return files.get(this.name) || '';
    }
    write(content) {
      files.set(this.name, String(content));
    }
    delete() {
      files.delete(this.name);
    }
    static async downloadFileAsync(_url, target) {
      // Simulate partial write before abort/failure
      files.set(target.name, 'partial-bytes');
      if (shouldFail) {
        throw new Error('connection reset');
      }
      files.set(target.name, 'complete-video-bytes');
      return target;
    }
  }

  class MockDirectory {
    constructor() {
      this.exists = true;
    }
    create() {}
    list() {
      return Array.from(files.keys()).map((name) => new MockFile(this, name));
    }
  }

  const load = createLoader({
    'expo-file-system': {
      File: MockFile,
      Directory: MockDirectory,
      Paths: { cache: 'file:///cache' },
    },
    'expo-video': {
      getCurrentVideoCacheSize: () => 1024,
      setVideoCacheSizeAsync: async () => {},
      clearVideoCacheAsync: async () => {},
    },
    '../services/storage': {
      StorageService: { getCacheLimitMb: async () => 512 },
      DEFAULT_CACHE_LIMIT_MB: 512,
    },
  });

  const vfc = load(path.join(SRC, 'utils/videoFallbackCache.ts'));

  // Interrupted download must delete partial file so next call re-downloads
  const ctrl = new AbortController();
  await assert.rejects(
    () => vfc.downloadVideoViaAppSession('https://cdn.example.com/clip.mp4', {}, ctrl.signal),
    /connection reset/
  );
  const videoFilesAfterFail = Array.from(files.keys()).filter((k) => k.endsWith('.mp4'));
  assert.equal(videoFilesAfterFail.length, 0, 'partial video file must be deleted on error');

  // Subsequent download succeeds cleanly
  shouldFail = false;
  const uri = await vfc.downloadVideoViaAppSession('https://cdn.example.com/clip.mp4', {}, ctrl.signal);
  assert.ok(uri.endsWith('.mp4'));

  // nativeTrackedKeys FIFO cap at 500
  for (let i = 0; i < 525; i++) {
    vfc.recordCachedVideo(`https://cdn.example.com/vid_${i}.mp4`);
  }
  const trackedRaw = JSON.parse(files.get('native-tracked.json'));
  assert.equal(trackedRaw.length, 500, 'nativeTrackedKeys must be capped at 500 entries');
});

// 6. HentaiHaven /warden timeout signal, getAllGenres retry after failure, registerHentaiHavenAuthor updates cache
test('HentaiHaven /warden passes AbortSignal timeout, getAllGenres retries after failure, and registerHentaiHavenAuthor updates cachedGenres', async () => {
  let wardenSignal = null;
  let genreAllCalls = 0;
  let failGenreAll = true;

  const load = createLoader(
    {
      './proxyService': { proxyService: { fetchWithFallback: async () => new Response('', { status: 404 }) } },
    },
    {
      fetch: async (url, init) => {
        const u = String(url);
        if (u.endsWith('/warden')) {
          wardenSignal = init?.signal ?? null;
          return new Response(JSON.stringify({ data: { token: 'hh-tok' } }), { status: 200 });
        }
        if (u.endsWith('/genre/all')) {
          genreAllCalls++;
          if (failGenreAll) {
            return new Response('err', { status: 500 });
          }
          return new Response(
            JSON.stringify({
              data: [{ term_id: 9999, name: 'Dynamic Genre', slug: 'dynamic-genre', count: 42 }],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    }
  );

  const hh = load(path.join(SRC, 'services/hentaihavens.ts'));

  // 1st call: genre/all fails -> must NOT permanently cache empty dynamic list
  const res1 = await hh.searchHentaiHavenTags('dynamic', 10);
  assert.ok(wardenSignal, '/warden fetch must include an AbortSignal timeout');
  assert.equal(genreAllCalls, 1);
  assert.equal(res1.some((t) => t.name.toLowerCase().includes('dynamic')), false);

  // 2nd call: genre/all succeeds -> now finds dynamic genre and caches it
  failGenreAll = false;
  const res2 = await hh.searchHentaiHavenTags('dynamic', 10);
  assert.equal(genreAllCalls, 2);
  assert.equal(res2.some((t) => t.name.toLowerCase().includes('dynamic')), true);

  // 3rd call: uses cache (no extra /genre/all fetch) and includes newly registered author
  hh.registerHentaiHavenAuthor({ term_id: 88888, name: 'Fresh Studio', count: 7 });
  const res3 = await hh.searchHentaiHavenTags('fresh', 10);
  assert.equal(genreAllCalls, 2);
  assert.equal(res3.some((t) => t.name.toLowerCase().includes('fresh')), true);
});

// 7. Media & source resolvers clean up AbortSignal listeners in finally and short-circuit on aborted signal
test('Media and source detail resolvers remove AbortSignal listeners in finally and short-circuit when already aborted', async () => {
  const createTrackedSignal = (initiallyAborted = false) => {
    const listeners = new Set();
    return {
      aborted: initiallyAborted,
      addEventListener(_type, fn) {
        listeners.add(fn);
      },
      removeEventListener(_type, fn) {
        listeners.delete(fn);
      },
      get listenerCount() {
        return listeners.size;
      },
    };
  };

  let fetchCalls = 0;
  const mockProxy = {
    proxyService: {
      fetchWithFallback: async () => {
        fetchCalls++;
        return new Response('<html></html>', { status: 200 });
      },
      proxyUrl: (u) => u,
      isEnabled: () => false,
      getWorkerUrl: () => '',
    },
  };

  const load = createLoader(
    {
      'react-native': { Platform: { OS: 'ios' } },
      '../services/proxyService': mockProxy,
      './proxyService': mockProxy,
    },
    {
      fetch: async (url) => {
        fetchCalls++;
        if (String(url).endsWith('/warden')) {
          return new Response(JSON.stringify({ data: { token: 't' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      },
    }
  );

  const media = load(path.join(SRC, 'utils/media.ts'));
  const sexcom = load(path.join(SRC, 'services/sexcom.ts'));
  const nhentai = load(path.join(SRC, 'services/nhentai.ts'));
  const hh = load(path.join(SRC, 'services/hentaihavens.ts'));

  // Active signal: listeners must be removed after completion
  const sig = createTrackedSignal(false);
  await media.resolveXVideosVideoUrls({ sourceLink: 'https://www.xvideos.com/video1/test' }, sig);
  assert.equal(sig.listenerCount, 0, 'resolveXVideosVideoUrls leaked abort listener');

  await media.resolveXHamsterVideoUrls({ sourceLink: 'https://xhamster.com/videos/test-1' }, sig);
  assert.equal(sig.listenerCount, 0, 'resolveXHamsterVideoUrls leaked abort listener');

  await media.resolvePornhubVideoUrls({ sourceLink: 'https://www.pornhub.com/view_video.php?viewkey=abc123' }, sig);
  assert.equal(sig.listenerCount, 0, 'resolvePornhubVideoUrls leaked abort listener');

  await sexcom.resolveSexComVideoUrls({ sourceLink: 'https://www.sex.com/pin/123/' }, sig);
  assert.equal(sig.listenerCount, 0, 'resolveSexComVideoUrls leaked abort listener');

  await nhentai.resolveNHentaiGalleryDetail({ id: 'nh_12345' }, sig);
  assert.equal(sig.listenerCount, 0, 'resolveNHentaiGalleryDetail leaked abort listener');

  await hh.fetchHentaiHavenApi('series/1', {}, 5000, sig);
  assert.equal(sig.listenerCount, 0, 'fetchHentaiHavenApi leaked abort listener');

  // Pre-aborted signal: must not dispatch any network fetch
  const beforeCalls = fetchCalls;
  const abortedSig = createTrackedSignal(true);
  assert.equal(await media.resolveXVideosVideoUrls({ sourceLink: 'https://www.xvideos.com/video1/test' }, abortedSig), null);
  assert.equal(await media.resolveXHamsterVideoUrls({ sourceLink: 'https://xhamster.com/videos/test-1' }, abortedSig), null);
  assert.equal(await media.resolvePornhubVideoUrls({ sourceLink: 'https://www.pornhub.com/view_video.php?viewkey=abc123' }, abortedSig), null);
  assert.equal(await sexcom.resolveSexComVideoUrls({ sourceLink: 'https://www.sex.com/pin/123/' }, abortedSig), null);
  await assert.rejects(() => hh.fetchHentaiHavenApi('series/1', {}, 5000, abortedSig), (e) => e.name === 'AbortError');
  assert.equal(fetchCalls, beforeCalls, 'already-aborted signals must not trigger network calls');
});

// 8. Cum.st /api/v1/tags memory cache & HentaiHaven parallel multi-token fetch
test('Cum.st searchTags caches /api/v1/tags across calls and HentaiHaven multi-token fetch runs in parallel', async () => {
  let cumstTagFetches = 0;
  const loadBooru = createLoader({
    './storage': { StorageService: { getBlacklistedTags: async () => [] } },
    './proxyService': {
      proxyService: {
        ensureInitialized: async () => {},
        isEnabled: () => false,
        getWorkerUrl: () => '',
        fetchWithFallback: async (url) => {
          const u = String(url);
          if (u.includes('/api/v1/tags')) {
            cumstTagFetches++;
            return new Response(
              JSON.stringify({
                tags: [
                  { slug: 'blonde', label: 'Blonde', posts: 50 },
                  { slug: 'blue_eyes', label: 'Blue Eyes', posts: 30 },
                ],
              }),
              { status: 200 }
            );
          }
          if (u.includes('/api/v1/creators')) {
            return new Response(JSON.stringify({ creators: [] }), { status: 200 });
          }
          return new Response('{}', { status: 404 });
        },
      },
    },
  });

  const { BooruApiService } = loadBooru(path.join(SRC, 'services/booruApi.ts'));
  const cumst = { id: 'cumst', name: 'Cum.st', baseUrl: 'https://cum.st', type: 'cumst' };
  const api = new BooruApiService();

  const s1 = await api.searchTags('blo', 10, cumst);
  const s2 = await api.searchTags('blu', 10, cumst);
  assert.equal(s1.length, 1);
  assert.equal(s2.length, 1);
  assert.equal(cumstTagFetches, 1, '/api/v1/tags should be fetched once and served from TTL cache');

  // HentaiHaven multi-token parallel fetch
  let inFlight = 0;
  let maxConcurrent = 0;
  const loadHH = createLoader(
    {
      './proxyService': { proxyService: { fetchWithFallback: async () => new Response('', { status: 404 }) } },
    },
    {
      fetch: async (url) => {
        const u = String(url);
        if (u.endsWith('/warden')) {
          return new Response(JSON.stringify({ data: { token: 'hh-tok' } }), { status: 200 });
        }
        if (u.endsWith('/genre/all')) {
          return new Response(
            JSON.stringify({
              data: [
                { term_id: 101, name: 'Yuri', slug: 'yuri', count: 10 },
                { term_id: 102, name: 'Ecchi', slug: 'ecchi', count: 10 },
              ],
            }),
            { status: 200 }
          );
        }
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((r) => setTimeout(r, 25));
        inFlight--;
        return new Response(JSON.stringify({ data: [{ id: 1, title: 'Test', slug: 'test', thumbnail: 'https://x/1.jpg' }] }), { status: 200 });
      },
    }
  );
  const hh = loadHH(path.join(SRC, 'services/hentaihavens.ts'));
  const hhSource = { id: 'hentaihaven', name: 'HentaiHaven', baseUrl: 'https://hentaihaven.xxx', type: 'hentaihaven' };
  await hh.fetchHentaiHavenPosts(hhSource, 1, 'yuri ecchi');
  assert.ok(maxConcurrent >= 2, `expected parallel multi-token fetches, got maxConcurrent=${maxConcurrent}`);
});
