const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

const SOURCE = { id: 'rule34', name: 'Rule34.xxx', type: 'gelbooru', baseUrl: 'https://api.rule34.xxx' };
const AUTH = { userId: '123456', apiKey: 'test-key-only' };
function setup(auth = AUTH, body = [], status = 200) {
  const requests = [];
  let gelbooruReads = 0;
  const load = createLoader({
    './sources': { DEFAULT_SOURCE: SOURCE },
    './storage': { StorageService: {
      getRule34Auth: async () => auth,
      getGelbooruAuth: async () => { gelbooruReads++; return { userId: '987', apiKey: 'gelbooru-only' }; },
      getBlacklistedTags: async () => [],
    } },
    './proxyService': {}, './xvideos': {}, './xhamster': {}, './pornhub': {},
    './sexcom': {}, './hentaihavens': {}, './nhentai': {},
  }, { console: { ...console, warn() {} } });
  const api = new (load(path.resolve(__dirname, '../src/services/booruApi.ts')).BooruApiService)();
  api.fetchWithRetry = async (url) => {
    requests.push(new URL(url));
    return new Response(JSON.stringify(body), { status });
  };
  return { api, requests, gelbooruReads: () => gelbooruReads };
}

test('Rule34 without credentials reports the required settings instead of an empty feed', async () => {
  for (const auth of [{ userId: '', apiKey: '' }, { userId: '123', apiKey: '' }, { userId: '', apiKey: 'key' }]) {
    const { api, requests } = setup(auth);
    await assert.rejects(api.fetchPosts(1, 20, '', undefined, SOURCE), /Rule34.*Settings.*Sources.*Rule34\.xxx/);
    assert.equal(requests.length, 0);
  }
});

test('Rule34 feed/search uses its own saved credentials and preserves query/pagination', async () => {
  const { api, requests, gelbooruReads } = setup({ userId: ' 123456 ', apiKey: ' test-key-only ' }, [{
    id: 42, preview_url: 'https://cdn.test/thumb.jpg', file_url: 'https://cdn.test/full.jpg',
    width: 800, height: 1000, tags: 'landscape scenery', rating: 's', image: 'full.jpg',
  }]);
  const posts = await api.fetchPosts(2, 24, 'landscape', undefined, SOURCE);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].sourceId, 'rule34');
  assert.equal(posts[0].previewUrl, 'https://cdn.test/thumb.jpg');
  const params = requests[0].searchParams;
  assert.equal(params.get('api_key'), AUTH.apiKey);
  assert.equal(params.get('user_id'), AUTH.userId);
  assert.equal(params.get('tags'), 'landscape');
  assert.equal(params.get('pid'), '1');
  assert.equal(params.get('limit'), '24');
  assert.equal(gelbooruReads(), 0);
});

test('stored Rule34 credentials override legacy source auth without duplicate parameters', async () => {
  const { api, requests } = setup();
  await api.fetchPosts(1, 20, '', undefined, { ...SOURCE, authParams: 'api_key=old-test-key&user_id=9' });
  assert.deepEqual(requests[0].searchParams.getAll('api_key'), [AUTH.apiKey]);
  assert.deepEqual(requests[0].searchParams.getAll('user_id'), [AUTH.userId]);
});

test('Rule34 HTTP 200 authentication errors never masquerade as zero search results', async () => {
  for (const body of [
    'Missing authentication. Go to api.rule34.xxx for more information',
    'Invalid API key',
    { success: false, message: 'Invalid user_id' },
  ]) {
    const { api } = setup(AUTH, body);
    await assert.rejects(api.fetchPosts(1, 20, '', undefined, SOURCE), /Rule34.*Settings/);
  }
});

test('Rule34 HTTP auth failures and rate limits identify the right source', async () => {
  for (const status of [401, 403]) {
    const { api } = setup(AUTH, {}, status);
    await assert.rejects(api.fetchPosts(1, 20, '', undefined, SOURCE), /Rule34.*Settings/);
  }
  const { api } = setup(AUTH, {}, 429);
  await assert.rejects(api.fetchPosts(1, 20, '', undefined, SOURCE), /Rule34 rate limit/);
});

test('Rule34 distinguishes a real empty list from server-declared search failure', async () => {
  const empty = setup();
  assert.equal((await empty.api.fetchPosts(1, 20, '', undefined, SOURCE)).length, 0);
  const failed = setup(AUTH, { success: false, message: 'search down' });
  await assert.rejects(failed.api.fetchPosts(1, 20, '', undefined, SOURCE), /Rule34 API could not complete/);
});

test('Gelbooru requests still use only the Gelbooru key', async () => {
  const { api, requests, gelbooruReads } = setup();
  await api.fetchPosts(1, 20, '', undefined, { ...SOURCE, id: 'gelbooru', name: 'Gelbooru', baseUrl: 'https://gelbooru.com' });
  assert.equal(requests[0].searchParams.get('api_key'), 'gelbooru-only');
  assert.ok(gelbooruReads() > 0);
});
