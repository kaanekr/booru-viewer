const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');
const load = createLoader();
const { AVAILABLE_SOURCES } = load(path.resolve(__dirname, '../src/services/sources.ts'));
const { DEFAULT_FILTER_CONFIG } = load(path.resolve(__dirname, '../src/types/booru.ts'));
const { getSourceQuickFilters, isQuickFilterActive, applyQuickFilter, normalizeFeedQuickFilter } = load(path.resolve(__dirname, '../src/utils/sourceQuickFilters.ts'));
const source = (id) => AVAILABLE_SOURCES.find((s) => s.id === id);

const matrix = {
  gelbooru: ['latest,top', 'latest,top,safe,score50'],
  rule34: ['latest,top', 'latest,top,safe,score50'],
  realbooru: ['latest,top', 'latest,top,safe,score50'],
  danbooru: ['latest,top,week,month', 'latest,top,week,month,safe,score50'],
  yandere: ['latest,top,week,month', 'latest,top,week,month,safe,score50'],
  cumst: ['latest,day,week,month', 'latest,videos,onlyfans,fansly'],
  redgifs: ['default,recommended,latest,week,month', 'default,latest,week,month'],
  xvideos: ['default,recommended,latest,monthly-best', 'default,latest,top,week,month,rated'],
  xhamster: ['default,recommended,top,week,month', 'default,latest,top,week,month,rated'],
  pornhub: ['default,recommended', 'default,latest,top,week,month,rated'],
  sexcom: ['', ''],
  nhentai: ['latest,day,week,month,top', 'latest,day,week,month,top'],
  hentaihaven: [
    'latest,trending,episodes,yuri,ecchi,incest,tentacle,uncensored',
    'latest,trending,episodes,yuri,ecchi,incest,tentacle,uncensored,genre-harem,genre-anal,genre-milf,genre-bdsm',
  ],
};

test('every configured source has explicit feed and keyword-search capability coverage', () => {
  assert.deepEqual(Object.keys(matrix).sort(), Array.from(AVAILABLE_SOURCES, (s) => s.id).sort());
  for (const s of AVAILABLE_SOURCES) {
    assert.equal(getSourceQuickFilters(s, 'feed').map((o) => o.id).join(','), matrix[s.id][0], `${s.id} feed`);
    assert.equal(getSourceQuickFilters(s, 'search', true).map((o) => o.id).join(','), matrix[s.id][1], `${s.id} search`);
  }
});

test('every quick preset becomes active on application and resets stale pagination', () => {
  for (const s of AVAILABLE_SOURCES) {
    for (const context of ['feed', 'search']) {
      for (const option of getSourceQuickFilters(s, context, true)) {
        const next = applyQuickFilter(option, { ...DEFAULT_FILTER_CONFIG, jumpToPage: 99 }, false);
        assert.equal(isQuickFilterActive(option, next), true, `${s.id} ${option.id}`);
        assert.equal(next.jumpToPage, 1);
      }
    }
  }
});

test('no Safe/Points controls on video/manga sources and no fake timed Realbooru/Gelbooru tops', () => {
  for (const id of ['redgifs', 'xvideos', 'xhamster', 'pornhub', 'sexcom', 'nhentai', 'hentaihaven', 'cumst']) {
    assert.ok(getSourceQuickFilters(source(id), 'search', true).every((o) => !['safe', 'score50'].includes(o.id)), id);
  }
  for (const id of ['realbooru', 'gelbooru', 'rule34']) {
    assert.ok(getSourceQuickFilters(source(id), 'search', true).every((o) => !['week', 'month'].includes(o.id)), id);
  }
});

test('Cum.st leaderboard and service/media controls cannot silently ignore each other', () => {
  const s = source('cumst');
  const emptyOptions = getSourceQuickFilters(s, 'search', false);
  const video = emptyOptions.find((o) => o.id === 'videos');
  let next = applyQuickFilter(video, { ...DEFAULT_FILTER_CONFIG, sortBy: 'score', timeRange: '1w', leaderboardDate: '2026-10-01' });
  assert.equal(next.sortBy, 'id');
  assert.equal(next.timeRange, 'all');
  assert.equal(next.leaderboardDate, undefined);
  next = applyQuickFilter(emptyOptions.find((o) => o.id === 'week'), { ...next, cumstService: 'fansly' });
  assert.equal(next.cumstService, 'all');
  assert.equal(next.cumstMediaType, 'all');
  assert.ok(getSourceQuickFilters(s, 'search', true).every((o) => !['day', 'week', 'month'].includes(o.id)));
});

test('feed-only Discover sorts cannot masquerade as keywordless search sort support', () => {
  assert.equal(getSourceQuickFilters(source('pornhub'), 'search', false).map((o) => o.id).join(','), 'default');
  assert.equal(normalizeFeedQuickFilter(source('pornhub'), { sortBy: 'score', timeRange: '1w' }).sortBy, 'default');
  assert.equal(getSourceQuickFilters(source('xvideos'), 'search', false).map((o) => o.id).join(','), 'default,latest,monthly-best');
  const normalized = normalizeFeedQuickFilter(source('realbooru'), { sortBy: 'score', timeRange: '1m' });
  assert.equal(normalized.sortBy, 'id');
  assert.equal(normalized.timeRange, 'all');
});

test('Safe and minimum-score toggles can be removed without altering search tags', () => {
  const options = getSourceQuickFilters(source('yandere'), 'search', true);
  for (const id of ['safe', 'score50']) {
    const option = options.find((o) => o.id === id);
    let next = applyQuickFilter(option, { ...DEFAULT_FILTER_CONFIG, tags: ['landscape'] });
    assert.equal(isQuickFilterActive(option, next), true);
    next = applyQuickFilter(option, next);
    assert.equal(isQuickFilterActive(option, next), false);
    assert.equal(next.tags[0], 'landscape');
  }
});

test('real query generation uses corrected rating and descending/latest/all-time semantics', () => {
  const apiLoad = createLoader({ './storage': {}, './proxyService': {}, '../utils/guards': {}, './xvideos': {}, './xhamster': {}, './pornhub': {}, './sexcom': {}, './hentaihavens': {}, './nhentai': {} });
  const api = new (apiLoad(path.resolve(__dirname, '../src/services/booruApi.ts')).BooruApiService)();
  const query = (id, patch) => api.buildQueryTags({ ...DEFAULT_FILTER_CONFIG, ...patch }, source(id));
  assert.equal(query('danbooru', { rating: 'safe' }), 'rating:g');
  assert.equal(query('gelbooru', { rating: 'safe' }), 'rating:general');
  assert.equal(query('yandere', { rating: 'safe' }), 'rating:s');
  assert.equal(query('realbooru', { rating: 'safe' }), 'rating:safe');
  assert.equal(query('yandere', { sortBy: 'id' }), 'order:id_desc');
  assert.equal(query('danbooru', { sortBy: 'score' }), 'order:score');
  for (const id of ['realbooru', 'gelbooru']) assert.equal(query(id, { sortBy: 'score' }), 'sort:score:desc');
});

test('XVideos browse Latest and Monthly Best do not silently request the Discover homepage', () => {
  const { buildXVideosSearchCandidates } = createLoader()(path.resolve(__dirname, '../src/services/xvideos.ts'));
  const base = 'https://www.xvideos.com';
  assert.equal(buildXVideosSearchCandidates(base, 1, '', 'uploaddate', 'all')[0], `${base}/new/1`);
  assert.equal(buildXVideosSearchCandidates(base, 2, '', 'uploaddate', 'all')[0], `${base}/new/2`);
  assert.equal(buildXVideosSearchCandidates(base, 1, '', 'views', 'month')[0], `${base}/best`);
  assert.equal(buildXVideosSearchCandidates(base, 2, '', 'views', 'month', '2026-09')[0], `${base}/best/2026-09/1`);
  assert.equal(buildXVideosSearchCandidates(base, 1, '', 'relevance', 'all')[0], `${base}/`);
});
