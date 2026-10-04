const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Gercek booruApi yuklenir; ag/storage baglari mocklanir (sorgu kurma senkron).
// Cum.st haftalik/aylik capasi takvim basina yaslanir: ayni periyodun gunleri
// birebir ayni sorguyu uretir (kayma yok).
function loadApi() {
  const CUMST = { id: 'cumst', name: 'Cum.st', baseUrl: 'https://cum.st', type: 'cumst' };
  const filename = path.resolve(__dirname, '../src/services/booruApi.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (id === './sources') return { DEFAULT_SOURCE: CUMST };
      if (id === './proxyService') return {};
      if (id === './storage') return {};
      if (id === './xvideos') return {};
      if (id === './xhamster') return {};
      if (id === './pornhub') return {};
      if (id === '../utils/guards') return {};
      throw new Error('Unexpected dependency: ' + id);
    },
    console: { warn() {} },
    setTimeout, clearTimeout,
  }, { filename });
  const api = new module.exports.BooruApiService();
  return { api, snap: module.exports.snapLeaderboardAnchor, CUMST };
}

const DANBOORU = { id: 'danbooru', name: 'Danbooru', baseUrl: 'https://danbooru.donmai.us', type: 'danbooru' };

function scoreFilter(overrides) {
  return Object.assign({
    tags: [], sortBy: 'score', timeRange: 'all', rating: 'all',
    minScore: undefined, user: undefined, cumstService: 'all', cumstMediaType: 'all',
    leaderboardDate: undefined, jumpToPage: 1, includeBlacklisted: false,
    autocompleteFromServer: true,
  }, overrides);
}

test('same calendar week anchors produce byte-identical weekly query (2 gun once == bugun == dun)', () => {
  const { api, CUMST } = loadApi();
  const q = (date) => api.buildQueryTags(scoreFilter({ timeRange: '1w', leaderboardDate: date }), CUMST);
  const expected = 'date:2026-09-28 period:week sort:popular';
  assert.equal(q('2026-10-02'), expected);
  assert.equal(q('2026-10-03'), expected);
  assert.equal(q('2026-10-04'), expected);
  assert.equal(q('2026-09-28'), expected);
});

test('same calendar month anchors produce byte-identical monthly query', () => {
  const { api, CUMST } = loadApi();
  const q = (date) => api.buildQueryTags(scoreFilter({ timeRange: '1m', leaderboardDate: date }), CUMST);
  const expected = 'date:2026-10-01 period:month sort:popular';
  assert.equal(q('2026-10-02'), expected);
  assert.equal(q('2026-10-20'), expected);
  assert.equal(q('2026-10-01'), expected);
});

test('week snaps back to Monday, month to the 1st (UTC, Sunday and year edges)', () => {
  const { snap } = loadApi();
  assert.equal(snap('2026-10-04', '1w'), '2026-09-28');
  assert.equal(snap('2026-09-28', '1w'), '2026-09-28');
  assert.equal(snap('2026-10-31', '1w'), '2026-10-26');
  assert.equal(snap('2026-01-01', '1w'), '2025-12-29');
  assert.equal(snap('2026-02-01', '1w'), '2026-01-26');
  assert.equal(snap('2026-09-15', '1m'), '2026-09-01');
  assert.equal(snap('2026-10-31', '1m'), '2026-10-01');
});

test('day / all / year anchors pass through untouched', () => {
  const { api, snap, CUMST } = loadApi();
  assert.equal(snap('2026-10-02', '1d'), '2026-10-02');
  assert.equal(snap('2026-10-02', 'all'), '2026-10-02');
  assert.equal(snap('2026-10-02', '1y'), '2026-10-02');
  assert.equal(snap('2026-10-02', undefined), '2026-10-02');
  const q = api.buildQueryTags(scoreFilter({ timeRange: '1d', leaderboardDate: '2026-10-02' }), CUMST);
  assert.ok(q.includes('date:2026-10-02'));
  assert.ok(q.includes('period:day'));
});

test('invalid anchors pass through without crashing', () => {
  const { snap } = loadApi();
  assert.equal(snap('', '1w'), '');
  assert.equal(snap(undefined, '1w'), '');
  assert.equal(snap('garbage', '1w'), 'garbage');
  assert.equal(snap('2026-13-40', '1w'), '2026-13-40');
  assert.equal(snap('2026-02-30', '1w'), '2026-02-30');
  assert.equal(snap('2026-13-40', '1m'), '2026-13-40');
});

test('non-cumst engines keep raw anchor (danbooru date semantics untouched)', () => {
  const { api } = loadApi();
  const q = api.buildQueryTags(scoreFilter({ timeRange: '1w', leaderboardDate: '2026-10-02' }), DANBOORU);
  assert.ok(q.includes('date:2026-10-02'));
});
