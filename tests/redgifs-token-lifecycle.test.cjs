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
    '../utils/guards': {}, './xvideos': {}, './xhamster': {}, './pornhub': {}, './sexcom': {}, './hentaihavens': {}, './nhentai': {},
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
