const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadNHentai(customProxyFetch) {
  const filename = path.resolve(__dirname, '../src/services/nhentai.ts');
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
      throw new Error('nhentai must be UI-dependency-free, got: ' + id);
    },
    setTimeout, clearTimeout, AbortController,
  }, { filename });
  return module.exports;
}

const SOURCE = { id: 'nhentai', name: 'nhentai', baseUrl: 'https://nhentai.net', type: 'nhentai' };

test('extFromType converts nhentai short types to file extensions', () => {
  const nh = loadNHentai();
  assert.equal(nh.extFromType('j'), 'jpg');
  assert.equal(nh.extFromType('p'), 'png');
  assert.equal(nh.extFromType('w'), 'webp');
  assert.equal(nh.extFromType('g'), 'gif');
  assert.equal(nh.extFromType(''), 'jpg');
  assert.equal(nh.extFromType(undefined), 'jpg');
  assert.equal(nh.extFromType('custom'), 'jpg');
});

test('nhentaiApiSort maps sort option + time range to v2 sort values', () => {
  const nh = loadNHentai();
  assert.equal(nh.nhentaiApiSort('score', 'all'), 'popular');
  assert.equal(nh.nhentaiApiSort('score', '1d'), 'popular-today');
  assert.equal(nh.nhentaiApiSort('score', '1w'), 'popular-week');
  assert.equal(nh.nhentaiApiSort('score', '1m'), 'popular-month');
  assert.equal(nh.nhentaiApiSort('id', 'all'), 'date');
  assert.equal(nh.nhentaiApiSort('default', '1w'), 'date');
  assert.equal(nh.nhentaiApiSort(undefined, undefined), 'date');
});

test('nhentaiApiHeaders mimics Safari (no Referer, no encoding override)', () => {
  const nh = loadNHentai();
  const h = nh.nhentaiApiHeaders();
  assert.ok(h['User-Agent'].includes('Safari/'), 'tam Safari formu');
  assert.ok(!('Referer' in h), 'doğrudan gezinme gibi Referer yok');
  assert.ok(!('Accept-Encoding' in h), 'RN varsayılan sıkıştırma akışı kullanılır');
  assert.equal(h['Accept'], 'application/json,*/*');
  const withExtra = nh.nhentaiApiHeaders({ 'Content-Type': 'application/json' });
  assert.equal(withExtra['Content-Type'], 'application/json');
});

test('buildNHentaiApiCandidates builds v2 feed, popular and search urls according to docs', () => {
  const nh = loadNHentai();
  assert.equal(nh.NHENTAI_API_BASE, 'https://nhentai.net/api/v2');

  const feed = nh.buildNHentaiApiCandidates(2, '', 'date');
  assert.equal(feed[0], 'https://nhentai.net/api/v2/galleries?page=2&per_page=25');

  // Dokümana göre query=* tüm arşivi döner ve her sort türü için sayfalanabilir (25/sayfa)
  const popular = nh.buildNHentaiApiCandidates(1, '', 'popular');
  assert.equal(popular[0], 'https://nhentai.net/api/v2/search?query=*&sort=popular&page=1');

  // Günün popülerleri için hızlı adanmış endpoint (94ms; query=* sorgusundan katbekat hızlı)
  const today = nh.buildNHentaiApiCandidates(1, '', 'popular-today');
  assert.equal(today[0], 'https://nhentai.net/api/v2/galleries/popular');
  assert.equal(nh.buildNHentaiApiCandidates(2, '', 'popular-today').length, 0);

  const popularPage3 = nh.buildNHentaiApiCandidates(3, '', 'popular-week');
  assert.equal(popularPage3[0], 'https://nhentai.net/api/v2/search?query=*&sort=popular-week&page=3');

  const search = nh.buildNHentaiApiCandidates(3, 'big breasts', 'popular-week');
  assert.equal(search[0], 'https://nhentai.net/api/v2/search?query=big%20breasts&sort=popular-week&page=3');

  // Doküman: favorites:>=N yerel desteklenir, query sonuna otomatik eklenir
  const withMinScore = nh.buildNHentaiApiCandidates(1, 'naruto', 'popular', 1000);
  assert.equal(withMinScore[0], 'https://nhentai.net/api/v2/search?query=naruto%20favorites%3A%3E%3D1000&sort=popular&page=1');

  // tag: mekaniği ve dışlama aynen taşınır (tırnaklar encode edilir)
  const prefixed = nh.buildNHentaiApiCandidates(1, 'tag:"big breasts"', 'date');
  assert.equal(prefixed[0], 'https://nhentai.net/api/v2/search?query=tag%3A%22big%20breasts%22&sort=date&page=1');

  const negated = nh.buildNHentaiApiCandidates(2, 'tag:"sole female" -tag:"netorare"', 'popular');
  assert.equal(negated[0], 'https://nhentai.net/api/v2/search?query=tag%3A%22sole%20female%22%20-tag%3A%22netorare%22&sort=popular&page=2');
});

test('nhentaiTagQuery builds prefix mechanics per category', () => {
  const nh = loadNHentai();
  assert.equal(nh.nhentaiTagQuery('big breasts', 'general'), 'tag:"big breasts"');
  assert.equal(nh.nhentaiTagQuery('sole-female', 'general'), 'tag:"sole-female"');
  assert.equal(nh.nhentaiTagQuery('shindol', 'artist'), 'artist:"shindol"');
  assert.equal(nh.nhentaiTagQuery('naruto uzumaki', 'character'), 'character:"naruto uzumaki"');
  assert.equal(nh.nhentaiTagQuery('naruto', 'copyright'), 'parody:"naruto"');
  assert.equal(nh.nhentaiTagQuery('nunpokojin', 'artist'), 'artist:"nunpokojin"');
  assert.equal(nh.nhentaiTagQuery('english', 'meta'), 'language:"english"');
  assert.equal(nh.nhentaiTagQuery('doujinshi', 'meta'), 'category:"doujinshi"');
  // Bilinmeyen meta öneksiz kalır (yanlış önek boş sonuç demek)
  assert.equal(nh.nhentaiTagQuery('color', 'meta'), 'color');
  assert.equal(nh.nhentaiTagQuery('mystery', undefined), 'mystery');
  // Zaten önekli girdi normalize edilir, çift öneklenmez
  assert.equal(nh.nhentaiTagQuery('tag:sole-female', 'general'), 'tag:sole-female');
  assert.equal(nh.nhentaiTagQuery('tag:big breasts', 'general'), 'tag:"big breasts"');
  assert.equal(nh.nhentaiTagQuery('artist:shindol', 'artist'), 'artist:shindol');
  assert.equal(nh.nhentaiTagQuery('', 'general'), '');
});

test('rotateNhentaiImageHost cycles i-hosts and stops at the end', () => {
  const nh = loadNHentai();
  assert.equal(nh.NHENTAI_API_IMAGE_HOSTS.join('|'), [
    'https://i2.nhentai.net',
    'https://i3.nhentai.net',
    'https://i4.nhentai.net',
    'https://i1.nhentai.net',
  ].join('|'));
  assert.equal(
    nh.rotateNhentaiImageHost('https://i2.nhentai.net/galleries/9/1.webp'),
    'https://i3.nhentai.net/galleries/9/1.webp'
  );
  assert.equal(
    nh.rotateNhentaiImageHost('https://i4.nhentai.net/galleries/9/1.webp'),
    'https://i1.nhentai.net/galleries/9/1.webp'
  );
  // Liste bitti -> null (vazgeç); yol korunur
  assert.equal(nh.rotateNhentaiImageHost('https://i1.nhentai.net/galleries/9/1.webp'), null);
  // nhentai dışı URL'ye dokunulmaz
  assert.equal(nh.rotateNhentaiImageHost('https://example.com/1.jpg'), null);
  assert.equal(nh.rotateNhentaiImageHost(''), null);
  assert.equal(nh.rotateNhentaiImageHost(undefined), null);
});

test('parseNHentaiV2Listing maps num_favorites to score and favCount', () => {
  const nh = loadNHentai();
  const body = JSON.stringify({
    result: [
      {
        id: 685915,
        media_id: '4224557',
        english_title: 'Furina Hu Tao [English]',
        thumbnail: 'galleries/4224557/thumb.webp',
        thumbnail_width: 250,
        thumbnail_height: 350,
        num_pages: 21,
        num_favorites: 454,
        tag_ids: [1, 2],
        blacklisted: false,
      },
      { id: 2, media_id: '9', num_favorites: 5, blacklisted: true },
    ],
  });
  const posts = nh.parseNHentaiV2Listing(body, SOURCE);
  assert.equal(posts.length, 1, 'kara listelenenler elenir');
  const p = posts[0];
  assert.equal(p.id, 'nh_685915');
  assert.equal(p.title, 'Furina Hu Tao [English]');
  assert.equal(p.score, 454, 'skor favori sayısına eşlenir');
  assert.equal(p.favCount, 454);
  assert.equal(p.pageCount, 21);
  assert.equal(p.mediaId, '4224557');
  assert.equal(p.previewUrl, 'https://t2.nhentai.net/galleries/4224557/thumb.webp');
  assert.equal(p.sampleUrl, 'https://t3.nhentai.net/galleries/4224557/cover.webp');
  assert.equal(p.originalUrl, 'https://i2.nhentai.net/galleries/4224557/1.webp');
  // Ayna ve net ayrı id uzayına sahip: detay daima net'ten çözülmeli
  assert.equal(p.sourceLink, 'https://nhentai.net/g/685915/');
  assert.ok(Math.abs(p.aspectRatio - 250 / 350) < 0.001);

  // popular endpoint düz dizi döner
  const arr = nh.parseNHentaiV2Listing('[{"id":1,"media_id":"7","num_favorites":10}]', SOURCE);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].score, 10);
});

test('parseNHentaiV2Listing keeps jpg galleries on the jpg CDN path', () => {
  const nh = loadNHentai();
  const body = JSON.stringify({
    result: [{ id: 210670, media_id: '1125595', thumbnail: 'galleries/1125595/thumb.jpg', num_pages: 25 }],
  });
  const p = nh.parseNHentaiV2Listing(body, SOURCE)[0];
  // thumb.jpg -> 1.webp 404 veriyordu (canlı doğrulandı)
  assert.equal(p.fileExt, 'jpg');
  assert.equal(p.originalUrl, 'https://i2.nhentai.net/galleries/1125595/1.jpg');
});

test('parseNHentaiV2Listing puts cover on a different CDN host than thumb', () => {
  const nh = loadNHentai();
  const body = JSON.stringify({
    result: [{ id: 1, media_id: '7', thumbnail: 'galleries/7/thumb.webp', num_pages: 1 }],
  });
  const p = nh.parseNHentaiV2Listing(body, SOURCE)[0];
  assert.ok(p.previewUrl.startsWith('https://t2.nhentai.net/'));
  assert.ok(p.sampleUrl.startsWith('https://t3.nhentai.net/'));
  assert.ok(p.sampleUrl.includes('/cover.webp'));
});

test('parseNHentaiV2DetailTags groups tags and returns favorites', () => {
  const nh = loadNHentai();
  const body = JSON.stringify({
    num_favorites: 12000,
    tags: [
      { type: 'category', name: 'doujinshi' },
      { type: 'artist', name: 'tachi iyashi' },
      { type: 'parody', name: 'naruto' },
      { type: 'tag', name: 'big breasts' },
      { type: 'language', name: 'english' },
      { type: 'tag', name: 'big breasts' },
    ],
  });
  const { tags, allTags, numFavorites } = nh.parseNHentaiV2DetailTags(body);
  assert.equal(numFavorites, 12000);
  assert.equal(tags.meta.join(','), 'manga,doujinshi,english');
  assert.equal(tags.artist.join(','), 'tachi iyashi');
  assert.equal(tags.copyright.join(','), 'naruto');
  assert.equal(tags.general.join(','), 'big breasts');
  assert.equal(allTags.length, 5, 'tekrar eden etiketler elenir');
});

test('parseNHentaiGalleryPages reads v2 detail page paths in order', () => {
  const nh = loadNHentai();
  const body = JSON.stringify({
    media_id: '4224557',
    pages: [
      { number: 2, path: 'galleries/4224557/2.webp' },
      { number: 1, path: 'galleries/4224557/1.webp' },
    ],
  });
  const pages = nh.parseNHentaiGalleryPages(body, '685915');
  assert.equal(pages.join('|'),
    'https://i2.nhentai.net/galleries/4224557/1.webp|https://i2.nhentai.net/galleries/4224557/2.webp');
});

test('detail resolution uses only the v2 API detail endpoint', async () => {
  const netCalls = [];
  const nhNet = loadNHentai(async (url) => {
    netCalls.push(url);
    if (url.includes('/api/v2/galleries/685915')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          media_id: '4224557',
          num_favorites: 610,
          tags: [{ type: 'tag', name: 'big breasts' }],
          pages: [{ number: 1, path: 'galleries/4224557/1.webp' }],
        }),
      };
    }
    return { ok: false, status: 404 };
  });
  const netDetail = await nhNet.resolveNHentaiGalleryDetail({
    id: 'nh_685915',
    sourceLink: 'https://nhentai.net/g/685915/',
    mediaId: '4224557',
    pageCount: 21,
    fileExt: 'webp',
  });
  assert.equal(netDetail.pageCount, 1);
  assert.equal(netDetail.numFavorites, 610);
  assert.ok(netCalls.every((u) => u.includes('/api/v2/galleries/685915')), 'v2 API detay endpointi cagrilir');

  // Ağ hatasında sentetik güvenlik ağı (i2.nhentai.net)
  const nhOffline = loadNHentai(async () => ({ ok: false, status: 500 }));
  const fallback = await nhOffline.resolveNHentaiGalleryDetail({
    id: 'nh_685915',
    mediaId: '4224557',
    pageCount: 3,
    fileExt: 'webp',
  });
  assert.equal(fallback.pageCount, 3);
  assert.equal(fallback.pages[0], 'https://i2.nhentai.net/galleries/4224557/1.webp');
  assert.equal(fallback.pages[2], 'https://i2.nhentai.net/galleries/4224557/3.webp');
});

test('parseNHentaiGalleryPages parses pages from API JSON', () => {
  const nh = loadNHentai();
  const detailJson = JSON.stringify({
    media_id: '1556093',
    images: {
      pages: [{ t: 'j' }, { t: 'p' }, { t: 'w' }],
    },
  });
  const pages = nh.parseNHentaiGalleryPages(detailJson, '298547');
  assert.equal(pages.length, 3);
  assert.equal(pages[0], 'https://i2.nhentai.net/galleries/1556093/1.jpg');
  assert.equal(pages[1], 'https://i2.nhentai.net/galleries/1556093/2.png');
  assert.equal(pages[2], 'https://i2.nhentai.net/galleries/1556093/3.webp');
});

test('resolveNHentaiPages resolves pages end-to-end with synthetic fallback', async () => {
  const customFetch = async (url) => {
    if (url.includes('/api/v2/galleries/298547')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          id: 298547,
          media_id: '1556093',
          num_favorites: 42,
          tags: [{ type: 'tag', name: 'big breasts' }],
          pages: [
            { number: 1, path: 'galleries/1556093/1.jpg' },
            { number: 2, path: 'galleries/1556093/2.jpg' },
          ],
        }),
      };
    }
    return { ok: false, status: 403 };
  };

  const nh = loadNHentai(customFetch);
  const resolved = await nh.resolveNHentaiPages({
    id: 'nh_298547',
    sourceLink: 'https://nhentai.net/g/298547/',
    mediaId: '1556093',
    pageCount: 2,
    fileExt: 'jpg',
  });
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0], 'https://i2.nhentai.net/galleries/1556093/1.jpg');

  // Synthetic fallback when network fails but mediaId + pageCount exist
  const nhOffline = loadNHentai(async () => ({ ok: false, status: 500 }));
  const fallback = await nhOffline.resolveNHentaiPages({
    id: 'nh_999',
    sourceLink: 'https://nhentai.net/g/999/',
    mediaId: '888',
    pageCount: 3,
    fileExt: 'jpg',
  });
  assert.equal(fallback.length, 3);
  assert.equal(fallback[0], 'https://i2.nhentai.net/galleries/888/1.jpg');
  assert.equal(fallback[2], 'https://i2.nhentai.net/galleries/888/3.jpg');
});

test('searchNHentaiTags returns instant autocomplete suggestions with categories', async () => {
  const nh = loadNHentai();
  const soleSuggestions = await nh.searchNHentaiTags('sole');
  assert.ok(soleSuggestions.length >= 2);
  assert.equal(soleSuggestions[0].name, 'sole female');
  assert.equal(soleSuggestions[0].category, 'general');

  const genshinSuggestions = await nh.searchNHentaiTags('genshin');
  assert.ok(genshinSuggestions.length >= 1);
  assert.equal(genshinSuggestions[0].name, 'genshin impact');
  assert.equal(genshinSuggestions[0].category, 'copyright');

  const empty = await nh.searchNHentaiTags('');
  assert.equal(empty.length, 0);
});

test('searchNHentaiApiTags uses official POST /api/v2/tags/search', async () => {
  let requestedUrl = '';
  let requestMethod = '';
  let requestBody = '';
  const customFetch = async (url, opts) => {
    requestedUrl = url;
    requestMethod = opts?.method;
    requestBody = opts?.body;
    return {
      ok: true,
      json: async () => [
        { id: 2197, type: 'parody', name: 'naruto', slug: 'naruto', count: 2197 },
        { id: 1089, type: 'character', name: 'naruto uzumaki', slug: 'naruto-uzumaki', count: 1089 },
        { id: 15, type: 'artist', name: 'naruto artist', slug: 'naruto-artist', count: 12 },
      ],
    };
  };

  const nh = loadNHentai(customFetch);
  const tags = await nh.searchNHentaiApiTags('naruto', 10);
  assert.equal(requestedUrl, 'https://nhentai.net/api/v2/tags/search');
  assert.equal(requestMethod, 'POST');
  assert.deepEqual(JSON.parse(requestBody), { query: 'naruto', limit: 10 });

  assert.equal(tags.length, 3);
  assert.equal(tags[0].name, 'naruto');
  assert.equal(tags[0].category, 'copyright');
  assert.equal(tags[0].postCount, 2197);

  assert.equal(tags[1].name, 'naruto uzumaki');
  assert.equal(tags[1].category, 'character');

  assert.equal(tags[2].name, 'naruto artist');
  assert.equal(tags[2].category, 'artist');
});

test('resolveNHentaiGalleryDetail resolves pages and categorized tags together via v2 API', async () => {
  const customFetch = async (url) => {
    if (url.includes('/api/v2/galleries/703517')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          id: 703517,
          media_id: 'testfolder',
          num_pages: 20,
          num_favorites: 107,
          tags: [
            { id: 1, type: 'artist', name: 'cool artist' },
            { id: 2, type: 'tag', name: 'milf' },
          ],
          pages: [
            { number: 1, path: 'galleries/testfolder/1.webp' },
            { number: 2, path: 'galleries/testfolder/2.webp' },
          ],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const nh = loadNHentai(customFetch);
  const detail = await nh.resolveNHentaiGalleryDetail({ id: 'nh_703517' });
  assert.equal(detail.pages.length, 2);
  assert.equal(detail.pages[0], 'https://i2.nhentai.net/galleries/testfolder/1.webp');
  assert.equal(detail.tags.artist[0], 'cool artist');
  assert.equal(detail.tags.general[0], 'milf');
  assert.ok(detail.allTags.includes('cool artist'));
  assert.ok(detail.allTags.includes('milf'));
  assert.equal(detail.numFavorites, 107);
});
