const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Gercek hentaihavens.ts yuklenir; tip importu derlemede silinir, modul bagimsizdir.
function loadHentai(customProxyFetch) {
  const filename = path.resolve(__dirname, '../src/services/hentaihavens.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (id === './proxyService') {
        return {
          proxyService: {
            fetchWithFallback: (url, opts, ms) => {
              if (customProxyFetch) return customProxyFetch(url, opts, ms);
              return Promise.resolve({ ok: true, text: async () => '' });
            },
          },
        };
      }
      throw new Error('hentaihavens must be UI-dependency-free, got: ' + id);
    },
    setTimeout, clearTimeout, AbortController,
  }, { filename });
  return module.exports;
}

const SOURCE = { id: 'hentaihaven', name: 'HentaiHaven', baseUrl: 'https://hentaihaven.xxx', type: 'hentaihaven' };

function cardHtml(o) {
  return '<div class=\"min-w-0\"><div class=\"block\">' +
    '<a class=\"group relative block aspect-[2/3] w-full overflow-hidden rounded-lg\" href=\"/watch/' + o.slug + '/\">' +
    '<img alt=\"' + o.title + '\" draggable=\"false\" loading=\"lazy\" decoding=\"async\" data-nimg=\"fill\" class=\"object-cover\" src=\"' + o.poster + '\"/>' +
    '<span aria-label=\"Rating ' + o.rating + ' out of 5\"><svg></svg>' + o.rating + '</span>' +
    '<span aria-label=\"' + o.viewsLabel + ' views\"><svg></svg>' + o.viewsText + '</span>' +
    '</a>' +
    '<div class=\"mt-2\"><a aria-label=\"' + o.title + '\" href=\"/watch/' + o.slug + '/\"><span>' + o.title + '</span></a></div>' +
    '</div></div>';
}

const LISTING = '<html><body><div class=\"grid\">' + cardHtml({
  slug: 'sample-series-alpha', title: 'Sample Series Alpha',
  poster: 'https://img.hentaihaven.xxx/images/t/e/s/sample-series-alpha.jpg',
  rating: '4.5', viewsLabel: '681,000', viewsText: '681K',
}) + cardHtml({
  slug: 'sample-series-beta', title: 'Sample Series Beta',
  poster: 'https://img.hentaihaven.xxx/images/t/e/s/sample-series-beta.jpg',
  rating: '3.8', viewsLabel: '12,345', viewsText: '12,345',
}) + '<div class=\"space-y-2\"><div data-slot=\"skeleton\" class=\"aspect-[2/3]\"></div></div>' +
  '</div></body></html>';

test('parses series cards with poster, title, views and dedupes', () => {
  const hh = loadHentai();
  const posts = hh.parseHentaiHavenListing(LISTING, SOURCE);
  assert.equal(posts.length, 2);
  const first = posts[0];
  assert.equal(first.id, 'hh_sample-series-alpha');
  assert.equal(first.title, 'Sample Series Alpha');
  assert.equal(first.previewUrl, 'https://img.hentaihaven.xxx/images/t/e/s/sample-series-alpha.jpg');
  assert.equal(first.previewVideoUrl, undefined);
  assert.equal(first.sampleUrl, 'https://img.hentaihaven.xxx/images/t/e/s/sample-series-alpha.jpg');
  assert.equal(first.originalUrl, '');
  assert.equal(first.sourceLink, 'https://hentaihaven.xxx/watch/sample-series-alpha/');
  assert.equal(first.fileExt, 'mp4');
  assert.equal(first.aspectRatio, 2 / 3);
  assert.equal(first.score, 681000);
  assert.equal(first.rating, 'e');
  assert.ok(first.tags.meta.includes('video'));
  assert.equal(posts[1].score, 12345);
  assert.equal(hh.parseHentaiHavenListing(LISTING + LISTING, SOURCE).length, 2);
  assert.equal(hh.parseHentaiHavenListing('', SOURCE).length, 0);
});

test('view counter parses comma and K/M/B forms', () => {
  const hh = loadHentai();
  assert.equal(hh.parseHentaiHavenCount('681,000'), 681000);
  assert.equal(hh.parseHentaiHavenCount('1.3M'), 1300000);
  assert.equal(hh.parseHentaiHavenCount('850'), 850);
  assert.equal(hh.parseHentaiHavenCount(''), 0);
  assert.equal(hh.parseHentaiHavenCount(undefined), 0);
});

test('builds trending feed and tag search urls with paging', () => {
  const hh = loadHentai();
  assert.equal(hh.buildHentaiHavenSearchCandidates('https://hentaihaven.xxx', 1, '')[0], 'https://hentaihaven.xxx/browse/trending/');
  assert.equal(hh.buildHentaiHavenSearchCandidates('https://hentaihaven.xxx', 3, '')[0], 'https://hentaihaven.xxx/browse/trending/page/3/');
  assert.equal(hh.buildHentaiHavenSearchCandidates('https://hentaihaven.xxx', 1, 'School Girl')[0], 'https://hentaihaven.xxx/tag/school-girl/');
  assert.equal(hh.buildHentaiHavenSearchCandidates('https://hentaihaven.xxx/', 2, 'school')[0], 'https://hentaihaven.xxx/tag/school/page/2/');
  assert.equal(hh.buildHentaiHavenSearchCandidates('https://hentaihaven.xxx', 1, '!!!').length, 0);
});

test('query slugifies to tag form', () => {
  const hh = loadHentai();
  assert.equal(hh.hentaiHavenTagSlug('School Girl'), 'school-girl');
  assert.equal(hh.hentaiHavenTagSlug('  Ecchi! '), 'ecchi');
  assert.equal(hh.hentaiHavenTagSlug('a_b__c'), 'a-b-c');
  assert.equal(hh.hentaiHavenTagSlug('!!!'), '');
  assert.equal(hh.hentaiHavenTagSlug(undefined), '');
});

const SERIES = '<html><body>' +
  '<a data-episode-preview-hover=\"true\" href=\"/watch/sample-series-alpha/episode-2/\">' +
  '<img alt=\"Episode 2\" src=\"https://coverlanyvd.org/storage/2026/09/23/sample-series-alpha-2/s_thumbnail.webp\"/>' +
  '<span>EP 02</span></a>' +
  '<a href=\"/watch/sample-series-alpha/episode-1/\">' +
  '<img alt=\"Episode 1\" src=\"https://coverlanyvd.org/storage/2026/06/18/sample-series-alpha-1/s_thumbnail.webp\"/>' +
  '<span>EP 01</span></a>' +
  '<a href=\"/watch/other-series-zzz/episode-8/\">related</a>' +
  '</body></html>';

test('episodes resolve to latest of the same series, related excluded', () => {
  const hh = loadHentai();
  const eps = hh.parseHentaiHavenEpisodes(SERIES, 'https://hentaihaven.xxx/watch/sample-series-alpha/');
  assert.equal(eps.length, 2);
  assert.equal(eps[0].ep, 2);
  assert.equal(eps[0].url, '/watch/sample-series-alpha/episode-2/');
  assert.equal(eps[1].ep, 1);
  assert.equal(hh.parseHentaiHavenEpisodes(SERIES, 'https://hentaihaven.xxx/watch/other-series-zzz/').length, 1);
  assert.equal(hh.parseHentaiHavenEpisodes('', 'https://hentaihaven.xxx/watch/x/').length, 0);
});

const DETAIL = '<html><head><script type=\"application/ld+json\">' +
  '{\"@context\":\"https://schema.org\",\"@type\":\"VideoObject\",' +
  '\"name\":\"Sample Episode\",\"thumbnailUrl\":[\"https://coverlanyvd.org/storage/2026/09/23/sample-2/thumbnail.webp\"],' +
  '\"uploadDate\":\"2026-09-23T12:30:11.000Z\",\"duration\":\"PT15M40S\",' +
  '\"contentUrl\":\"https://octopusmanifest.org/1d9a468b/playlist.m3u8\",' +
  '\"url\":\"https://hentaihaven.xxx/watch/sample-series-alpha/episode-2/\"}' +
  '</script></head><body></body></html>';

test('parses episode json-ld into hls, thumb and duration', () => {
  const hh = loadHentai();
  const files = hh.parseHentaiHavenEpisodeDetail(DETAIL);
  assert.equal(files.hls, 'https://octopusmanifest.org/1d9a468b/playlist.m3u8');
  assert.equal(files.thumb, 'https://coverlanyvd.org/storage/2026/09/23/sample-2/thumbnail.webp');
  assert.equal(files.durationSec, 940);
  const empty = hh.parseHentaiHavenEpisodeDetail('');
  assert.equal(empty.hls, '');
});

test('finds VideoObject when earlier json-ld blocks lack contentUrl (real page shape)', () => {
  const hh = loadHentai();
  const html = '<html><head>' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"HentaiHaven"}</script>' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","url":"https://hentaihaven.xxx/watch/s/episode-2/"}]}</script>' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Ep 2",' +
    '"thumbnailUrl":["https://coverlanyvd.org/storage/2026/09/23/s-2/thumbnail.webp"],' +
    '"duration":"PT15M40S",' +
    '"contentUrl":"https://octopusmanifest.org/1d9a468b-622c-472e-8a37-2adb5dbdfba1/playlist.m3u8"}</script>' +
    '</head><body></body></html>';
  const files = hh.parseHentaiHavenEpisodeDetail(html);
  assert.equal(files.hls, 'https://octopusmanifest.org/1d9a468b-622c-472e-8a37-2adb5dbdfba1/playlist.m3u8');
  assert.equal(files.durationSec, 940);
});

test('episode helpers are exported for the viewer EP selector', () => {
  const hh = loadHentai();
  assert.equal(typeof hh.listHentaiHavenEpisodes, 'function');
  assert.equal(typeof hh.resolveHentaiHavenEpisodeUrl, 'function');
  assert.equal(typeof hh.resolveHentaiHavenEpisodeUrls, 'function');
});

test('resolveHentaiHavenEpisodeUrls respects preferredEp and returns full episode list', async () => {
  const customFetch = async (url) => {
    if (url.includes('/watch/sample-series-alpha/episode-1/')) {
      return {
        ok: true,
        text: async () =>
          '<html><head><script type="application/ld+json">' +
          '{"@context":"https://schema.org","@type":"VideoObject","contentUrl":"https://cdn.example.com/ep1/playlist.m3u8"}' +
          '</script></head><body></body></html>',
      };
    }
    if (url.includes('/watch/sample-series-alpha/episode-2/')) {
      return {
        ok: true,
        text: async () =>
          '<html><head><script type="application/ld+json">' +
          '{"@context":"https://schema.org","@type":"VideoObject","contentUrl":"https://cdn.example.com/ep2/playlist.m3u8"}' +
          '</script></head><body></body></html>',
      };
    }
    return {
      ok: true,
      text: async () => SERIES,
    };
  };

  const hh = loadHentai(customFetch);

  // Tercihli bolum yoksa en yeni bolum (EP 2)
  const latest = await hh.resolveHentaiHavenEpisodeUrls({
    sourceLink: 'https://hentaihaven.xxx/watch/sample-series-alpha/',
  });
  assert.ok(latest);
  assert.equal(latest.hls, 'https://cdn.example.com/ep2/playlist.m3u8');
  assert.equal(latest.episodes.length, 2);
  assert.equal(latest.episodes[0].ep, 2);

  // Tercihli bolum verildiginde (son izlenen: EP 1) EP 1 cozulur
  const preferred = await hh.resolveHentaiHavenEpisodeUrls(
    { sourceLink: 'https://hentaihaven.xxx/watch/sample-series-alpha/' },
    undefined,
    1
  );
  assert.ok(preferred);
  assert.equal(preferred.hls, 'https://cdn.example.com/ep1/playlist.m3u8');
  assert.equal(preferred.episodes.length, 2);
});

test('falls back to player source tag and detects challenge pages', () => {
  const hh = loadHentai();
  const sourceOnly = '<html><body><video preload="none"><source src="https://octopusmanifest.org/abc/playlist.m3u8" type="application/vnd.apple.mpegurl"/></video></body></html>';
  assert.equal(hh.parseHentaiHavenEpisodeDetail(sourceOnly).hls, 'https://octopusmanifest.org/abc/playlist.m3u8');
  const mp4Only = '<html><body><video src="https://cdn.example.com/v/ep2.mp4"></video></body></html>';
  const mp4 = hh.parseHentaiHavenEpisodeDetail(mp4Only);
  assert.equal(mp4.hls, '');
  assert.equal(mp4.mp4, 'https://cdn.example.com/v/ep2.mp4');
  assert.equal(hh.isChallengeHtml('<div>Enable JavaScript and cookies to continue</div>'), true);
  assert.equal(hh.isChallengeHtml('<div>window._cf_chl_opt</div>'), true);
  assert.equal(hh.isChallengeHtml(DETAIL), false);
  assert.equal(hh.isChallengeHtml(''), false);
});
