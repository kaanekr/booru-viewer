const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApi(send) {
  let worker = '';
  const mocks = {
    './sources': { DEFAULT_SOURCE: {} },
    './proxyService': { proxyService: {
      ensureInitialized: async () => {},
      isEnabled: () => !!worker,
      getWorkerUrl: () => worker,
    } },
    './storage': { StorageService: {
      getRedGifsTokenCache: async () => { throw new Error('Must not reuse persisted device-bound tokens'); },
      setRedGifsTokenCache: async () => { throw new Error('Must not persist device-bound tokens'); },
    } },
    '../utils/guards': {},
    '../utils/imageDimensions': { enrichPostAspectRatios: async (p) => p },
    '../utils/lruCache': { LruCache: class { constructor() { this.m = new Map(); } get(k) { return this.m.get(k); } set(k, v) { this.m.set(k, v); } } },
    './xvideos': {}, './xhamster': {}, './pornhub': {}, './sexcom': {}, './hentaihavens': {}, './nhentai': { searchNHentaiTags: async () => [] },
  };
  const filename = path.resolve(__dirname, '../src/services/booruApi.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports, console: { warn() {} },
    require: (id) => {
      if (!(id in mocks)) throw new Error(`Unexpected dependency: ${id}`);
      return mocks[id];
    },
  }, { filename });
  const api = new module.exports.BooruApiService();
  // Replace the transport boundary, exercise real token/retry/public endpoint code.
  api.fetchRedGifsApi = send;
  return { api, setWorker: (url) => { worker = url; } };
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('WrongSender obtains a new token instead of reloading the rejected disk token', async () => {
  const tokens = [];
  let authCalls = 0;
  const { api } = loadApi(async (_url, token) => {
    if (!token) return response({ token: `token-${++authCalls}` });
    tokens.push(token);
    return token === 'token-1'
      ? response({ error: { code: 'WrongSender' } }, 401)
      : response({ niches: [] });
  });
  await api.warmupRedGifs();
  await api.fetchRedGifsNiches();
  assert.equal(authCalls, 2);
  assert.deepEqual(tokens, ['token-1', 'token-2']);
});

test('concurrent 401 responses share one refresh; late 401 does not invalidate it', async () => {
  let authCalls = 0;
  const pending = [];
  const { api } = loadApi(async (_url, token) => {
    if (!token) return response({ token: `token-${++authCalls}` });
    if (token === 'token-1') return new Promise((resolve) => pending.push(resolve));
    return response({ niches: [] });
  });
  await api.warmupRedGifs();
  const a = api.fetchRedGifsNiches('a');
  const b = api.fetchRedGifsNiches('b');
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  pending[0](response({}, 401));
  await a;
  pending[1](response({}, 401));
  await b;
  assert.equal(authCalls, 2);
});

test('parallel cold-start requests share authentication', async () => {
  let authCalls = 0;
  const { api } = loadApi(async (_url, token) => {
    if (!token) { authCalls++; return response({ token: 'fresh' }); }
    return response({ niches: [] });
  });
  await Promise.all([api.warmupRedGifs(), api.fetchRedGifsNiches('a'), api.fetchRedGifsNiches('b')]);
  assert.equal(authCalls, 1);
});

test('changing proxy route does not reuse the previous route token', async () => {
  let authCalls = 0;
  const { api, setWorker } = loadApi(async (_url, token) => {
    if (!token) return response({ token: `token-${++authCalls}` });
    return response({ niches: [] });
  });
  await api.fetchRedGifsNiches();
  setWorker('https://proxy.test');
  await api.fetchRedGifsNiches();
  assert.equal(authCalls, 2);
});

test('persistent 401 is retried once, not recursively', async () => {
  let authCalls = 0;
  let dataCalls = 0;
  const { api } = loadApi(async (_url, token) => {
    if (!token) return response({ token: `token-${++authCalls}` });
    dataCalls++;
    return response({}, 401);
  });
  await api.fetchRedGifsNiches();
  assert.equal(authCalls, 2);
  assert.equal(dataCalls, 2);
});

test('failed authentication does not leave a rejected single-flight promise cached', async () => {
  let authCalls = 0;
  const { api } = loadApi(async (_url, token) => {
    if (!token) {
      authCalls++;
      return authCalls === 1 ? response({}, 503) : response({ token: 'fresh' });
    }
    return response({ niches: [] });
  });
  await assert.rejects(api.fetchRedGifsNiches(), /503/);
  await api.fetchRedGifsNiches();
  assert.equal(authCalls, 2);
});

const redGifsSource = { id: 'redgifs', name: 'RedGifs', type: 'redgifs', baseUrl: 'https://www.redgifs.com' };
const tagFilter = (tags) => ({ tags, sortBy: 'default', timeRange: 'all', rating: 'all' });

test('RedGifs sends underscore-separated tag labels as spaced API search text', async () => {
  const urls = [];
  const { api } = loadApi(async (url, token) => {
    if (!token) return response({ token: 'fresh' });
    urls.push(new URL(url));
    return response({ gifs: [] });
  });
  await api.fetchPostsWithFilter(tagFilter(['real_couples']), 1, 24, redGifsSource);
  assert.equal(urls[0].searchParams.get('tags'), 'real couples');
  await api.fetchPostsWithFilter(tagFilter(['real couples', 'outdoor']), 2, 24, redGifsSource);
  assert.equal(urls[1].searchParams.get('tags'), 'real couples outdoor');
  assert.equal(urls[1].searchParams.get('page'), '2');
});

test('RedGifs autocomplete normalizes partial underscore queries and its labels can be searched again', async () => {
  const urls = [];
  const { api } = loadApi(async (url, token) => {
    if (!token) return response({ token: 'fresh' });
    const parsed = new URL(url);
    urls.push(parsed);
    return parsed.pathname.endsWith('/suggest')
      ? response([{ text: 'Real Couples', gifs: 10 }])
      : response({ gifs: [] });
  });
  const suggestions = await api.searchTags('real_cou', 12, redGifsSource);
  assert.equal(urls[0].searchParams.get('query'), 'real cou');
  assert.equal(suggestions[0].name, 'real_couples');
  await api.fetchPostsWithFilter(tagFilter([suggestions[0].name]), 1, 24, redGifsSource);
  assert.equal(urls[1].searchParams.get('tags'), 'real couples');
});

test('RedGifs user/niche identifiers keep their underscores and tag exclusions still work locally', async () => {
  const urls = [];
  const { api } = loadApi(async (url, token) => {
    if (!token) return response({ token: 'fresh' });
    urls.push(new URL(url));
    return response({ gifs: [
      { id: 'keep', userName: 'creator_name', tags: ['Real Couples'] },
      { id: 'exclude', userName: 'creator_name', tags: ['Real Couples', 'Single Person'] },
      { id: 'unrelated', userName: 'creator_name', tags: ['Landscape'] },
    ] });
  });
  const userPosts = await api.fetchPostsWithFilter(tagFilter(['user:creator_name', 'real_couples', '-single_person']), 1, 24, redGifsSource);
  assert.equal(urls[0].pathname, '/v2/users/creator_name/search');
  assert.equal(urls[0].searchParams.has('tags'), false);
  assert.deepEqual(Array.from(userPosts, (p) => p.id), ['rg_keep']);
  const nichePosts = await api.fetchPostsWithFilter(tagFilter(['niche:category_name', 'real_couples', '-single_person']), 1, 24, redGifsSource);
  assert.equal(urls[1].pathname, '/v2/niches/category_name/gifs');
  assert.deepEqual(Array.from(nichePosts, (p) => p.id), ['rg_keep']);
});

test('non-RedGifs providers retain underscore-separated booru tags', async () => {
  const { api } = loadApi(async () => { throw new Error('Unexpected network request'); });
  let received;
  api.fetchDanbooruPosts = async (_source, _page, _limit, tags) => { received = tags; return []; };
  await api.fetchPostsWithFilter(tagFilter(['real_couples']), 1, 24, { id: 'danbooru', type: 'danbooru' });
  assert.equal(received, 'real_couples');
});

test('RedGifs mapping keeps the independent poster as an image fallback', () => {
  const { api } = loadApi(async () => { throw new Error('Unexpected request'); });
  const posts = api.mapRedGifsGifs(redGifsSource, [{ id: 'clip', urls: {
    thumbnail: 'https://media.redgifs.com/Clip-mobile.jpg',
    poster: 'https://media.redgifs.com/Clip-poster.jpg',
    sd: 'https://media.redgifs.com/Clip-mobile.mp4',
  } }]);
  assert.equal(posts[0].previewUrl, 'https://media.redgifs.com/Clip-mobile.jpg');
  assert.equal(posts[0].previewFallbackUrl, 'https://media.redgifs.com/Clip-poster.jpg');
});

test('RedGifs mapping ignores empty and non-string thumbnail values before choosing a poster', () => {
  const { api } = loadApi(async () => { throw new Error('Unexpected request'); });
  for (const thumbnail of ['  ', 42, null]) {
    const [post] = api.mapRedGifsGifs(redGifsSource, [{ id: 'clip', urls: {
      thumbnail, poster: 'https://media.redgifs.com/Clip-poster.jpg',
    } }]);
    assert.equal(post.previewUrl, 'https://media.redgifs.com/Clip-poster.jpg');
    assert.equal(post.previewFallbackUrl, undefined);
  }
});
