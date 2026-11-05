const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

function setup(send, globals = {}) {
  const requests = [];
  const load = createLoader({
    './proxyService': { proxyService: { workerHeaders: (_url, headers) => headers } },
    './pornhub': { PORNHUB_BASE: 'https://www.pornhub.com', PORNHUB_UA: 'test-ua', parsePornhubHtmlListing: () => [1, 2] },
    './sexcom': { SEXCOM_BASE: 'https://www.sex.com', SEXCOM_UA: 'test-ua', parseSexComListing: () => [1, 2] },
    './hentaihavens': { HENTAIHAVEN_BASE: 'https://hentaihaven.xxx', HENTAIHAVEN_UA: 'test-ua', parseHentaiHavenListing: () => [1, 2] },
    './xvideos': { XVIDEOS_BASE: 'https://www.xvideos.com', XVIDEOS_UA: 'test-ua', parseXVideosListing: () => [1, 2] },
    './xhamster': { XHAMSTER_BASE: 'https://xhamster.com', XHAMSTER_UA: 'test-ua', parseXhamsterListing: () => [1, 2] },
  }, {
    fetch: async (url, init) => { requests.push({ url, init }); return send ? send(url, init) : new Response('fixture', { status: 200 }); },
    ...globals,
  });
  return { testConnection: load(path.resolve(__dirname, '../src/services/networkDiagnostics.ts')).testProxyConnection, requests };
}

test('connection diagnostics retain direct/relay comparisons and card parsing without API credentials', async () => {
  const { testConnection, requests } = setup();
  const results = await testConnection('https://relay.test');
  assert.equal(results.length, 8);
  assert.equal(requests.length, 16);
  assert.equal(results.find((r) => r.name === 'XVideos').direct, '200 / 2 cards');
  for (const { url } of requests) {
    assert.doesNotMatch(url, /api_key|user_id/);
    if (url.startsWith('https://relay.test')) assert.ok(new URL(url).searchParams.get('url').startsWith('https://'));
  }
  const redgifs = requests.find((r) => r.url.startsWith('https://api.redgifs.com'));
  assert.equal(redgifs.init.headers.Origin, 'https://www.redgifs.com');
  assert.equal(redgifs.init.headers.Referer, 'https://www.redgifs.com/');
});

test('reachable authentication errors stay HTTP results rather than false successful checks', async () => {
  const { testConnection } = setup(() => new Response('unauthorized', { status: 401 }));
  const results = await testConnection('https://relay.test');
  assert.ok(results.every((r) => r.direct === '401' && r.relay === '401'));
});

test('diagnostic hard deadlines settle transports that ignore abort', async () => {
  const { testConnection, requests } = setup(() => new Promise(() => {}), {
    setTimeout: (callback) => { queueMicrotask(callback); return 1; }, clearTimeout() {},
  });
  const results = await testConnection('https://relay.test');
  assert.ok(results.every((r) => r.direct === 'Timed out' && r.relay === 'Timed out'));
  assert.ok(requests.every((r) => r.init.signal.aborted));
});
