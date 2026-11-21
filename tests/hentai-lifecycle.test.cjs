const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Gercek hentaihavens.ts yuklenir; tip importu derlemede silinir, modul bagimsizdir.
function loadHentai(customProxyFetch, customGlobalFetch) {
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
    fetch: customGlobalFetch || fetch,
    URLSearchParams, encodeURIComponent, decodeURIComponent, console,
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

test('official API warden token generation, caching, and single-flight mutex', async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    if (url.includes('/warden')) {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { token: 'mock-warden-jwt-token-xyz' } }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
  };

  const hh = loadHentai(null, mockFetch);
  const [t1, t2] = await Promise.all([
    hh.getHentaiHavenToken(),
    hh.getHentaiHavenToken(),
  ]);

  assert.equal(t1, 'mock-warden-jwt-token-xyz');
  assert.equal(t2, 'mock-warden-jwt-token-xyz');
  // Single flight: concurrent calls hit /warden only once
  assert.equal(callCount, 1);

  // Read from cache
  const t3 = await hh.getHentaiHavenToken();
  assert.equal(t3, 'mock-warden-jwt-token-xyz');
  assert.equal(callCount, 1);
});

test('fetchHentaiHavenPosts uses API for feed, genre, and text search', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/warden')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { token: 'mock-token' } }),
      };
    }
    if (url.includes('genre/all')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [{ term_id: 102, name: 'Yuri', slug: 'yuri', count: 194 }],
        }),
      };
    }
    if (url.includes('hentai/all?p=1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            hentais: [
              {
                post_ID: 7486,
                post_title: 'Kami Machi Sana-chan',
                post_name: 'kami-machi-sana-chan',
                post_thumbnail: 'https://img.hentaihaven.xxx/cover.jpg',
              },
            ],
          },
        }),
      };
    }
    if (url.includes('genre/102?p=1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            hentais: [
              {
                post_ID: 9999,
                post_title: 'Yuri Title',
                post_name: 'yuri-title',
                post_thumbnail: 'https://img.hentaihaven.xxx/yuri.jpg',
              },
            ],
          },
        }),
      };
    }
    if (url.includes('search?q=maid')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            {
              post_ID: 8888,
              post_title: 'Maid Kyouiku',
              post_name: 'maid-kyouiku',
              post_thumbnail: 'https://img.hentaihaven.xxx/maid.jpg',
            },
          ],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const hh = loadHentai(null, mockFetch);

  // 1. Empty query -> hentai/all
  const feed = await hh.fetchHentaiHavenPosts(SOURCE, 1, '');
  assert.equal(feed.length, 1);
  assert.equal(feed[0].id, 'hh_7486');
  assert.equal(feed[0].mediaId, '7486');
  assert.equal(feed[0].title, 'Kami Machi Sana-chan');
  assert.equal(feed[0].previewUrl, 'https://img.hentaihaven.xxx/cover.jpg');
  assert.equal(feed[0].sourceLink, 'https://hentaihaven.xxx/watch/kami-machi-sana-chan/');

  // 2. Genre search -> genre/102
  const genrePosts = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'yuri');
  assert.equal(genrePosts.length, 1);
  assert.equal(genrePosts[0].id, 'hh_9999');
  assert.equal(genrePosts[0].title, 'Yuri Title');

  // 3. Free text search -> search?q=maid
  const searchPosts = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'maid');
  assert.equal(searchPosts.length, 1);
  assert.equal(searchPosts[0].id, 'hh_8888');
  assert.equal(searchPosts[0].title, 'Maid Kyouiku');
});

test('resolveHentaiHavenEpisodeUrls resolves episodes and direct HLS stream from API', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/warden')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { token: 'mock-token' } }),
      };
    }
    if (url.includes('hentai/7486')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            post_ID: 7486,
            post_title: 'Kami Machi Sana-chan',
            post_name: 'kami-machi-sana-chan',
            post_content: 'Full description of the series.',
            post_views: 1801083,
            post_rating: { rating: '3.7', votes: 978 },
            post_genres: [{ name: 'Hentai School' }, { name: 'Anal' }],
            post_tags: [{ name: 'eHentai' }],
            post_authors: [{ name: 'Studio A' }],
            post_episodes: [
              {
                chapter_id: 4334,
                chapter_name: 'Episode 1',
                chapter_slug: 'episode-1',
                chapter_content: 'https://octopusmanifest.org/6cbe2a19/playlist.m3u8',
                preview: 'https://coverlanyvd.org/storage/preview.mp4',
                chapter_thumbnail: 'https://coverlanyvd.org/storage/thumbnail.webp',
              },
              {
                chapter_id: 4335,
                chapter_name: 'Episode 2',
                chapter_slug: 'episode-2',
                chapter_content: 'https://octopusmanifest.org/6cbe2a20/playlist.m3u8',
                preview: 'https://coverlanyvd.org/storage/preview2.mp4',
                chapter_thumbnail: 'https://coverlanyvd.org/storage/thumbnail2.webp',
              },
            ],
          },
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const hh = loadHentai(null, mockFetch);
  const resolved = await hh.resolveHentaiHavenEpisodeUrls({
    id: 'hh_7486',
    mediaId: '7486',
    sourceLink: 'https://hentaihaven.xxx/watch/kami-machi-sana-chan/',
  });

  assert.ok(resolved);
  // The newest episode (EP 2) is picked first
  assert.equal(resolved.hls, 'https://octopusmanifest.org/6cbe2a20/playlist.m3u8');
  assert.equal(resolved.mp4, 'https://coverlanyvd.org/storage/preview2.mp4');
  assert.equal(resolved.views, 1801083);
  assert.equal(resolved.description, 'Full description of the series.');
  assert.equal(resolved.episodes.length, 2);
  assert.equal(resolved.episodes[0].ep, 2);
  assert.equal(resolved.episodes[1].ep, 1);
  assert.ok(resolved.tags.general.includes('School'));
  assert.ok(!resolved.tags.general.includes('eHentai'));
  assert.ok(resolved.tags.artist.includes('Studio A'));

  // When a preferred episode (EP 1) is selected
  const ep1 = await hh.resolveHentaiHavenEpisodeUrls(
    { id: 'hh_7486', mediaId: '7486' },
    undefined,
    1
  );
  assert.ok(ep1);
  assert.equal(ep1.hls, 'https://octopusmanifest.org/6cbe2a19/playlist.m3u8');
});

test('searchHentaiHavenTags suggests genres from API', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/warden')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { token: 'mock-token' } }),
      };
    }
    if (url.includes('genre/all')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            { term_id: 222, name: 'Anal', slug: 'anal', count: 331 },
            { term_id: 11719, name: 'Big Breasts', slug: 'big-breasts', count: 50 },
            { term_id: 102, name: 'Yuri', slug: 'yuri', count: 194 },
          ],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const hh = loadHentai(null, mockFetch);
  const tags = await hh.searchHentaiHavenTags('anal');
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, 'Anal');
  assert.equal(tags[0].postCount, 331);
  assert.equal(tags[0].category, 'general');
});

test('cleanHentaiHavenTags filters out SEO spam tags and normalizes redundant suffixes', () => {
  const hh = loadHentai();

  const dirtyTags = [
    'e Hentai', 'xAnimePorn', 'eHentai', 'Hentai Stream',
    'Hanime TV', 'Anime Hentai', 'Hentai TV', 'Hanime',
    'mp4Hentai', 'HentaiDude', 'Watch Hentai', 'Anime Porn',
    'Sexy', 'Hentai Videos', 'Free Hentai', 'Hentai Anime',
    'Hentai', 'ge Hentai', 'Hentai Porn', 'Hentai Foundry',
    'Hentai Haven', 'HD', 'nHentai', 'Hentai Video',
    'Rule 34', 'Hentai Chan', 'Hentai Manga', 'Hentai Vid',
    'Gelbooru', 'Pornhub', 'xvideos', 'xhamster', 'hentaiporn',
    // Genuinely meaningful tags
    'School', 'Hentai School', 'School Girl',
    'Anal', 'Anal Hentai', 'Hentai Anal',
    'Yuri', 'Yuri Hentai', 'Yuri Porn',
    'Paizuri', 'Paizuri Hentai',
    'Big Boobs', 'Blow Job', 'Creampie', 'Facial',
    '3D Hentai',
  ];

  const cleaned = hh.cleanHentaiHavenTags(dirtyTags);

  // None of the spam tags should remain
  assert.ok(!cleaned.includes('e Hentai'));
  assert.ok(!cleaned.includes('eHentai'));
  assert.ok(!cleaned.includes('Hentai'));
  assert.ok(!cleaned.includes('Hentai Porn'));
  assert.ok(!cleaned.includes('hentaiporn'));
  assert.ok(!cleaned.includes('Gelbooru'));
  assert.ok(!cleaned.includes('Pornhub'));
  assert.ok(!cleaned.includes('xvideos'));
  assert.ok(!cleaned.includes('Hanime'));
  assert.ok(!cleaned.includes('HD'));
  assert.ok(!cleaned.includes('Sexy'));
  assert.ok(!cleaned.includes('Rule 34'));

  // Real tags must be preserved and simplified
  assert.ok(cleaned.includes('School'));
  assert.ok(cleaned.includes('School Girl'));
  assert.ok(cleaned.includes('Anal'));
  assert.ok(cleaned.includes('Yuri'));
  assert.ok(cleaned.includes('Paizuri'));
  assert.ok(cleaned.includes('Big Boobs'));
  assert.ok(cleaned.includes('Blow Job'));
  assert.ok(cleaned.includes('Creampie'));
  assert.ok(cleaned.includes('Facial'));
  assert.ok(cleaned.includes('3D Hentai'));

  // Duplicates must be removed ('Anal', 'Anal Hentai', 'Hentai Anal' should collapse to 'Anal')
  assert.equal(cleaned.filter((t) => t.toLowerCase() === 'anal').length, 1);
  assert.equal(cleaned.filter((t) => t.toLowerCase() === 'yuri').length, 1);
  assert.equal(cleaned.filter((t) => t.toLowerCase() === 'paizuri').length, 1);
});

test('parseHentaiHavenQuery tokenizes spaces, quotes, excludes and prefixes', () => {
  const hh = loadHentai();
  // Objects created in the vm context have a different prototype; compare via JSON.
  const parsed = (raw) => JSON.stringify(hh.parseHentaiHavenQuery(raw));
  const want = (include, exclude) => JSON.stringify({ include, exclude });

  assert.equal(parsed(''), want([], []));
  assert.equal(parsed('  '), want([], []));

  // A spaced search splits into separate tokens
  assert.equal(parsed('school girl'), want(['school', 'girl'], []));

  // A quoted group stays a single token
  assert.equal(parsed('"big breasts" anal'), want(['big breasts', 'anal'], []));

  // Exclusions and booru prefixes
  assert.equal(parsed('yuri -anal tag:ecchi genre:harem'), want(['yuri', 'ecchi', 'harem'], ['anal']));

  // Quoted exclusion
  assert.equal(parsed('-"big breasts" yuri'), want(['yuri'], ['big breasts']));
  assert.equal(parsed('yuri -tag:"big breasts" artist:"Lunar Press"'), want(['yuri', 'Lunar Press'], ['big breasts']));

  // Duplicates are deduped
  assert.equal(parsed('yuri Yuri YURI'), want(['yuri'], []));
});

test('findHentaiHavenGenre matches spaced, hyphenated and affixed spellings', () => {
  const hh = loadHentai();
  const genres = [
    { term_id: 102, name: 'Yuri', slug: 'yuri', count: 194 },
    { term_id: 815, name: 'Hentai School', slug: 'hentai-school', count: 466 },
    { term_id: 11714, name: 'School', slug: 'school', count: 5 },
    { term_id: 11732, name: 'Schoolgirl', slug: 'schoolgirl', count: 3 },
    { term_id: 64, name: 'Incest Hentai', slug: 'incest', count: 305 },
  ];

  assert.equal(hh.findHentaiHavenGenre(genres, 'yuri').term_id, 102);
  assert.equal(hh.findHentaiHavenGenre(genres, 'YURI').term_id, 102);
  // 'school girl' collapses to 'schoolgirl'
  assert.equal(hh.findHentaiHavenGenre(genres, 'school girl').term_id, 11732);
  assert.equal(hh.findHentaiHavenGenre(genres, 'school-girl').term_id, 11732);
  // An exact match takes priority
  assert.equal(hh.findHentaiHavenGenre(genres, 'school').term_id, 11714);
  // The ' Hentai' suffix can be dropped
  assert.equal(hh.findHentaiHavenGenre(genres, 'incest').term_id, 64);
  assert.equal(hh.findHentaiHavenGenre(genres, undefined), null);
  assert.equal(hh.findHentaiHavenGenre(genres, '!!!'), null);
  assert.equal(hh.findHentaiHavenGenre(genres, 'yaoi'), null);
});

function hhItem(id, title, name) {
  return {
    post_ID: id,
    post_title: title,
    post_name: name || ('title-' + id),
    post_thumbnail: 'https://img.hentaihaven.xxx/' + id + '.jpg',
  };
}

// genre/all is deliberately kept incomplete (no Yuri) so the static completer kicks in.
function mockHentaiApi(log) {
  return async (url) => {
    if (log) log.push(url);
    if (url.includes('/warden')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { token: 'mock-token' } }) };
    }
    if (url.includes('genre/all')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          success: true,
          data: [
            { term_id: 222, name: 'Anal', slug: 'anal', count: 331 },
            { term_id: 11732, name: 'Schoolgirl', slug: 'schoolgirl', count: 3 },
            { term_id: 815, name: 'Hentai School', slug: 'hentai-school', count: 466 },
          ],
        }),
      };
    }
    if (url.includes('genre/222?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(1, 'Anal Title One'), hhItem(2, 'Shared Title')] } }),
      };
    }
    if (url.includes('genre/102?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(2, 'Shared Title'), hhItem(3, 'Yuri Title')] } }),
      };
    }
    if (url.includes('genre/11732?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(9, 'Lone Schoolgirl')] } }),
      };
    }
    if (url.includes('genre/2627?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(11, 'Softcore Title')] } }),
      };
    }
    if (url.includes('genre/2605?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(12, 'Umemaro 3D Title')] } }),
      };
    }
    if (url.includes('genre/815?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(20, 'Hentai School Title')] } }),
      };
    }
    if (url.includes('genre/167?p=1') || url.includes('tag/167?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          success: true,
          data: {
            term: { term_id: 167, name: 'Pink Pineapple', slug: 'pink-pineapple', count: 161 },
            hentais: [hhItem(1671, 'Pineapple Hit One'), hhItem(1672, 'Pineapple Hit Two')],
          },
        }),
      };
    }
    if (url.includes('search?q=school')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: [hhItem(2, 'Shared Title'), hhItem(7, 'School Days')] }),
      };
    }
    if (url.includes('search?q=maid')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: [hhItem(8, 'Maid Kyouiku')] }),
      };
    }
    if (url.includes('hentai/all?p=1')) {
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { hentais: [hhItem(50, 'Latest One'), hhItem(51, 'Latest Two')] } }),
      };
    }
    if (url.includes('hentai/home')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          success: true,
          data: {
            trending_month: [{ ...hhItem(60, 'Trend One'), post_views: '342000' }],
            last_episodes: [
              {
                chapter_id: 4334, chapter_name: 'Episode 1', chapter_slug: 'episode-1',
                chapter_thumbnail: 'https://coverlanyvd.org/thumb.webp',
                chapter_date: '2026-10-01 16:21:10',
                post_ID: 7486, post_title: 'Kami Machi Sana-chan', post_name: 'kami-machi-sana-chan',
              },
            ],
          },
        }),
      };
    }
    return { ok: false, status: 404 };
  };
}

test('spaced search intersects per-token results (AND), static genre fallback included', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  // 'anal' -> genre/222 [1,2]; 'yuri' -> static 102 -> genre/102 [2,3]; intersection [2]
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'anal yuri');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'hh_2');
  assert.equal(posts[0].mediaId, '2');
});

test('empty intersection falls back to union instead of empty screen', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  // genre/222 [1,2] ∩ genre/11732 [9] = empty -> union [1,2,9]
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'anal schoolgirl');
  assert.equal(JSON.stringify(posts.map((p) => p.id)), JSON.stringify(['hh_1', 'hh_2', 'hh_9']));
});

test('quoted phrase resolves as single genre token', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  // '"school girl"' tek token 'school girl' -> compact 'schoolgirl' -> genre/11732
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, '"school girl"');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'hh_9');
});

test('title search is single-page: page > 1 hits no network and returns []', async () => {
  const log = [];
  const hh = loadHentai(null, mockHentaiApi(log));
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 2, 'maid');
  assert.equal(posts.length, 0);
  assert.ok(!log.some((u) => u.includes('search?q=')), 'search must not paginate, got: ' + log.join(' | '));
});

test('feed sections route to latest / trending / episodes', async () => {
  const log = [];
  const hh = loadHentai(null, mockHentaiApi(log));

  const latest = await hh.fetchHentaiHavenPosts(SOURCE, 1, '');
  assert.equal(JSON.stringify(latest.map((p) => p.id)), JSON.stringify(['hh_50', 'hh_51']));

  const trending = await hh.fetchHentaiHavenPosts(SOURCE, 1, '', { section: 'trending' });
  assert.equal(trending.length, 1);
  assert.equal(trending[0].id, 'hh_60');
  assert.equal(trending[0].score, 342000);

  const trendingPage2 = await hh.fetchHentaiHavenPosts(SOURCE, 2, '', { section: 'trending' });
  assert.equal(trendingPage2.length, 0);

  const episodes = await hh.fetchHentaiHavenPosts(SOURCE, 1, '', { section: 'episodes' });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].id, 'hh_ep_4334');
  assert.equal(episodes[0].mediaId, '7486');
  assert.equal(episodes[0].sourceLink, 'https://hentaihaven.xxx/watch/kami-machi-sana-chan/');
});

test('genre feed sections use static term ids without genre/all', async () => {
  const log = [];
  const hh = loadHentai(null, mockHentaiApi(log));
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, '', { section: 'yuri' });
  assert.equal(JSON.stringify(posts.map((p) => p.id)), JSON.stringify(['hh_2', 'hh_3']));
  assert.ok(!log.some((u) => u.includes('genre/all')), 'section feed must not need genre/all');
});

test('empty-query search honors score sort as trending fallback', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, '', { sortBy: 'score' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'hh_60');
});

test('tag suggestions include statically-known genres missing from genre/all', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  const tags = await hh.searchHentaiHavenTags('yuri');
  assert.ok(tags.some((t) => t.name === 'Yuri'), 'Yuri must be suggested, got: ' + JSON.stringify(tags));
  const yuri = tags.find((t) => t.name === 'Yuri');
  assert.equal(yuri.postCount, 194);
});

test('tag: prefix keeps multi-word genres as one token (other sources mechanic)', async () => {
  const hh = loadHentai(null, mockHentaiApi());

  // `tag:"big breasts" anal` -> ['big breasts', 'anal'] (prefix stripped)
  let parsed = hh.parseHentaiHavenQuery('tag:"big breasts" anal');
  assert.equal(
    JSON.stringify([parsed.include, parsed.exclude]),
    JSON.stringify([['big breasts', 'anal'], []])
  );

  // `tag:"school girl"` single token -> Schoolgirl genre page
  const quoted = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'tag:"school girl"');
  assert.equal(quoted.length, 1);
  assert.equal(quoted[0].id, 'hh_9');

  // The `genre:` prefix works the same way
  const genrePrefixed = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'genre:softcore');
  assert.equal(genrePrefixed.length, 1);
  assert.equal(genrePrefixed[0].id, 'hh_11');
});

test('hentaiHavenTagQuery qualifies info-window tags like other sources', () => {
  const hh = loadHentai();
  // Spaced genre -> tag:"..."
  assert.equal(hh.hentaiHavenTagQuery('Hentai School'), 'tag:"hentai school"');
  // Genre without spaces -> tag:...
  assert.equal(hh.hentaiHavenTagQuery('Anal'), 'tag:anal');
  // Red tag (artist) with spaces -> artist:"..."
  assert.equal(hh.hentaiHavenTagQuery('Pink Pineapple', 'artist'), 'artist:"pink pineapple"');
  // Red tag (artist) without spaces -> artist:...
  assert.equal(hh.hentaiHavenTagQuery('PoRO', 'artist'), 'artist:poro');
  // Already prefixed ones are preserved
  assert.equal(hh.hentaiHavenTagQuery('tag:"yuri"'), 'tag:"yuri"');
  assert.equal(hh.hentaiHavenTagQuery('genre:harem'), 'genre:harem');
  assert.equal(hh.hentaiHavenTagQuery('artist:suiseisha'), 'artist:suiseisha');
  assert.equal(hh.hentaiHavenTagQuery(''), '');
  assert.equal(hh.hentaiHavenTagQuery(undefined), '');
});

test('red artist tags resolve to official studio posts end-to-end', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  // 1. The artist query produced when tapping a red studio tag in the info sheet
  const query = hh.hentaiHavenTagQuery('Pink Pineapple', 'artist');
  assert.equal(query, 'artist:"pink pineapple"');

  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, query);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].id, 'hh_1671');
  assert.equal(posts[1].id, 'hh_1672');

  // 2. Searching the studio name as plain text also matches term_id 167
  const plainPosts = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'Pink Pineapple');
  assert.equal(plainPosts.length, 2);
  assert.equal(plainPosts[0].id, 'hh_1671');
});

test('isHentaiHavenOfficialGenre covers the /genres/ list leniently', () => {
  const hh = loadHentai();
  assert.equal(hh.HENTAIHAVEN_OFFICIAL_GENRE_NAMES.length, 61);
  const yes = [
    'Yuri', 'yuri', 'Schoolgirl', 'school girl', 'school-girl', 'Incest',
    'Incest Hentai', '3D Hentai', 'Umemaro 3D', 'Softcore', 'Yaoi',
    'Big Breasts', 'blowjob', 'Hentai School', 'Teen Hentai',
  ];
  for (const n of yes) assert.equal(hh.isHentaiHavenOfficialGenre(n), true, n);
  const no = ['Maid Kyouiku', 'Studio A', 'video', '', '!!!', 'school days', 'Anal Mania'];
  for (const n of no) assert.equal(hh.isHentaiHavenOfficialGenre(n), false, n);
});

test('info-window tag tap resolves to the genre page end to end', async () => {
  const hh = loadHentai(null, mockHentaiApi());
  // The 'Hentai School' row in the info sheet becomes `tag:"hentai school"`
  const query = hh.hentaiHavenTagQuery('Hentai School');
  const posts = await hh.fetchHentaiHavenPosts(SOURCE, 1, query);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'hh_20');
});

test('harvested official genres resolve without genre/all', async () => {
  const hh = loadHentai(null, mockHentaiApi());

  // softcore / umemaro 3d: absent from genre/all, comes from the static completer
  const softcore = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'softcore');
  assert.equal(softcore.length, 1);
  assert.equal(softcore[0].id, 'hh_11');

  const umemaro = await hh.fetchHentaiHavenPosts(SOURCE, 1, 'tag:"umemaro 3d"');
  assert.equal(umemaro.length, 1);
  assert.equal(umemaro[0].id, 'hh_12');

  // They also show up in suggestions
  const sug = await hh.searchHentaiHavenTags('soft');
  assert.ok(sug.some((t) => t.name === 'Softcore'), 'Softcore must be suggested');
  const yaoi = await hh.searchHentaiHavenTags('yaoi');
  assert.ok(yaoi.some((t) => t.name === 'Yaoi'), 'Yaoi must be suggested');
});
