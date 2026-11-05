const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

function setup(send) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const sent = [];
  const load = createLoader({
    './sources': { DEFAULT_SOURCE: { id: 'a', type: 'danbooru', baseUrl: 'https://a.test' } },
    './proxyService': { proxyService: { fetchWithFallback: async (url, init) => {
      sent.push({ url, at: now, signal: init.signal });
      return send ? send(url, init) : new Response('{}');
    } } },
    './storage': { StorageService: {} },
    '../utils/guards': {}, './xvideos': {}, './xhamster': {}, './pornhub': {},
    './sexcom': {}, './hentaihavens': {}, './nhentai': {},
  }, {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, ms) => { const key = ++id; timers.set(key, { at: now + ms, callback }); return key; },
    clearTimeout: (key) => timers.delete(key),
  });
  const api = new (load(path.resolve(__dirname, '../src/services/booruApi.ts')).BooruApiService)();
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return {
    api, sent, flush,
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const entry = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at;
        timers.delete(entry[0]);
        entry[1].callback();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

test('concurrent requests reserve separate 800ms slots per host, not one shared wake-up', async () => {
  const { api, sent, flush, advance } = setup();
  const requests = [
    api.fetchWithRetry('https://a.test/1'), api.fetchWithRetry('https://a.test/2'),
    api.fetchWithRetry('https://a.test/3'), api.fetchWithRetry('https://b.test/1'),
  ];
  await flush();
  assert.deepEqual(sent.map((r) => r.url), ['https://a.test/1', 'https://b.test/1']);
  await advance(799);
  assert.equal(sent.length, 2);
  await advance(1);
  assert.equal(sent[2].at, 800);
  await advance(800);
  assert.equal(sent[3].at, 1600);
  await Promise.all(requests);
});

test('queued caller cancellation prevents network dispatch and does not poison later slots', async () => {
  const { api, sent, flush, advance } = setup();
  const controller = new AbortController();
  const first = api.fetchWithRetry('https://a.test/1');
  const cancelled = assert.rejects(api.fetchWithRetry('https://a.test/2', { signal: controller.signal }), { name: 'AbortError' });
  controller.abort();
  await flush();
  await advance(800);
  await cancelled;
  const next = api.fetchWithRetry('https://a.test/3');
  await advance(800);
  await Promise.all([first, next]);
  assert.deepEqual(sent.map((r) => r.url), ['https://a.test/1', 'https://a.test/3']);
});

test('explicit query source survives a different global selection', async () => {
  const { api } = setup();
  const a = { id: 'a', type: 'danbooru', baseUrl: 'https://a.test' };
  api.setSource({ id: 'b', type: 'moebooru', baseUrl: 'https://b.test' });
  let observed;
  api.fetchDanbooruPosts = async (source, _page, _limit, tags) => { observed = { source, tags }; return []; };
  await api.fetchPostsWithFilter({ tags: ['landscape'], sortBy: 'id', rating: 'safe', timeRange: 'all' }, 1, 24, a);
  assert.equal(observed.source.id, 'a');
  assert.match(observed.tags, /landscape/);
  assert.match(observed.tags, /rating:g\b/);
  assert.equal(api.getSource().id, 'b');
});

test('caller cancellation reaches the live transport signal', async () => {
  const { api, sent, flush } = setup((_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('cancelled'); error.name = 'AbortError'; reject(error);
    }, { once: true });
  }));
  const controller = new AbortController();
  const request = assert.rejects(api.fetchWithRetry('https://a.test/1', { signal: controller.signal }), { name: 'AbortError' });
  await flush();
  controller.abort();
  await request;
  assert.equal(sent[0].signal.aborted, true);
});

test('hard timeout settles even when transport ignores abort', async () => {
  const { api, sent, flush, advance } = setup(() => new Promise(() => {}));
  const request = assert.rejects(api.fetchWithRetry('https://a.test/1'), /timeout after 12000ms/);
  await flush();
  await advance(12000);
  await request;
  assert.equal(sent[0].signal.aborted, true);
});

test('independent RedGifs lists do not consume each other results through global seen state', async () => {
  const { api } = setup();
  const source = { id: 'redgifs', type: 'redgifs', baseUrl: 'https://redgifs.test' };
  api.fetchRedGifsPosts = async () => [{ id: 'same', sourceId: source.id }];
  const first = await api.fetchPosts(1, 24, '', { tags: [] }, source);
  const second = await api.fetchPosts(1, 24, '', { tags: [] }, source);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
});
