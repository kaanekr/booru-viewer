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

test('buildNHentaiSearchCandidates builds feed and search URLs with paging', () => {
  const nh = loadNHentai();
  const feed = nh.buildNHentaiSearchCandidates('https://nhentai.xxx', 1, '');
  assert.equal(feed[0], 'https://nhentai.xxx/');
  assert.equal(feed[1], 'https://nhentai.xxx/api/galleries/all?page=1');

  const feed2 = nh.buildNHentaiSearchCandidates('https://nhentai.xxx', 2, '');
  assert.equal(feed2[0], 'https://nhentai.xxx/?page=2');

  const search = nh.buildNHentaiSearchCandidates('https://nhentai.xxx/', 2, 'genshin impact');
  assert.equal(search[0], 'https://nhentai.xxx/search/?key=genshin%20impact&page=2');
  assert.equal(search[1], 'https://nhentai.xxx/search/?q=genshin%20impact&page=2');
});

test('buildNHentaiSearchCandidates appends sort=popular for popular sort', () => {
  const nh = loadNHentai();
  // Etiketsiz popüler ana sayfada yok sayılır -> search endpoint'i kullanılır
  const feed = nh.buildNHentaiSearchCandidates('https://nhentai.xxx', 1, '', 'popular');
  assert.equal(feed[0], 'https://nhentai.xxx/search/?key=%20&page=1&sort=popular');

  const feed2 = nh.buildNHentaiSearchCandidates('https://nhentai.xxx', 3, '', 'popular');
  assert.equal(feed2[0], 'https://nhentai.xxx/search/?key=%20&page=3&sort=popular');

  const search = nh.buildNHentaiSearchCandidates('https://nhentai.xxx/', 2, 'naruto', 'popular');
  assert.equal(search[0], 'https://nhentai.xxx/search/?key=naruto&page=2&sort=popular');

  const plain = nh.buildNHentaiSearchCandidates('https://nhentai.xxx', 1, '', undefined);
  assert.equal(plain[0], 'https://nhentai.xxx/');
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

test('buildNHentaiApiCandidates builds v2 feed, popular and search urls', () => {
  const nh = loadNHentai();
  assert.equal(nh.NHENTAI_API_BASE, 'https://nhentai.net/api/v2');

  const feed = nh.buildNHentaiApiCandidates(2, '', 'date');
  assert.equal(feed.join('|'), 'https://nhentai.net/api/v2/galleries?page=2');

  const popular = nh.buildNHentaiApiCandidates(1, '', 'popular');
  assert.equal(popular.join('|'), 'https://nhentai.net/api/v2/galleries/popular');
  // popular endpoint sayfalı değil -> derin sayfalar API'ye gitmez
  assert.equal(nh.buildNHentaiApiCandidates(2, '', 'popular').length, 0);

  const search = nh.buildNHentaiApiCandidates(3, 'big breasts', 'popular-week');
  assert.equal(search[0], 'https://nhentai.net/api/v2/search?query=big%20breasts&sort=popular-week&page=3');

  // meta operatörleri temizlenir, normal kelimeler korunur
  const cleaned = nh.buildNHentaiApiCandidates(1, 'score:>50 naruto <3', 'date');
  assert.equal(cleaned[0], 'https://nhentai.net/api/v2/search?query=naruto&sort=date&page=1');
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
  assert.equal(p.previewUrl, 'https://t1.nhentai.net/galleries/4224557/thumb.webp');
  assert.equal(p.sampleUrl, 'https://t1.nhentai.net/galleries/4224557/cover.webp');
  assert.equal(p.originalUrl, 'https://i1.nhentai.net/galleries/4224557/1.webp');
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
  assert.equal(p.originalUrl, 'https://i1.nhentai.net/galleries/1125595/1.jpg');
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
    'https://i1.nhentai.net/galleries/4224557/1.webp|https://i1.nhentai.net/galleries/4224557/2.webp');
});

test('detail resolution never mixes mirror and net id spaces', async () => {
  // v2 (net) kayıt: yalnız api/v2 detay çağrılır, ayna HTML'i HİÇ çekilmez
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
  assert.ok(netCalls.every((u) => u.includes('/api/v2/')), 'net kaydı yalnız API ile çözülür');

  // Ayna kayıt: yalnız ayna HTML'i çekilir, api/v2'ye gidilmez
  const mirrorCalls = [];
  const nhMirror = loadNHentai(async (url) => {
    mirrorCalls.push(url);
    return { ok: false, status: 404 };
  });
  const mirrorDetail = await nhMirror.resolveNHentaiGalleryDetail({
    id: 'nh_685915',
    sourceLink: 'https://nhentai.xxx/g/685915/',
    mediaId: 'atyign0sbo',
    pageCount: 32,
  });
  assert.equal(mirrorCalls.length, 1);
  assert.ok(mirrorCalls[0].startsWith('https://nhentai.xxx/g/685915/'), 'ayana gidilir');
  assert.ok(
    mirrorDetail.pages[0] === 'https://i5.nhentaimg.com/018/atyign0sbo/1.webp',
    'ayana CDN sentetik sayfalar slug ile üretilir: ' + mirrorDetail.pages[0]
  );
});

test('parseNHentaiFavoritesFromHtml reads mirror favorite counter', () => {
  const nh = loadNHentai();
  const html =
    '<button class="mbtn disabled" id="fav_nl"><span class="fv_txt">Favorite</span> (<span class="fv_cnt">107</span>)</button>';
  assert.equal(nh.parseNHentaiFavoritesFromHtml(html), 107);
  assert.equal(nh.parseNHentaiFavoritesFromHtml('<span class="fv_cnt">1.2K</span>'), 1200);
  assert.equal(nh.parseNHentaiFavoritesFromHtml('<span class="fv_cnt">3M</span>'), 3000000);
  assert.equal(nh.parseNHentaiFavoritesFromHtml('favori yok'), 0);
});

const JSON_LISTING = JSON.stringify({
  result: [
    {
      id: 298547,
      media_id: '1556093',
      title: {
        english: '[Artist] Sample Manga (English)',
        japanese: '[作家] サンプルマンガ',
        pretty: 'Sample Manga',
      },
      images: {
        pages: [
          { t: 'j', w: 1280, h: 1807 },
          { t: 'j', w: 1280, h: 1807 },
          { t: 'p', w: 1280, h: 1807 },
        ],
        cover: { t: 'j', w: 350, h: 494 },
        thumbnail: { t: 'j', w: 250, h: 353 },
      },
      num_pages: 3,
      num_favorites: 4520,
      upload_date: 1579600000,
      tags: [
        { id: 1, type: 'tag', name: 'big breasts' },
        { id: 2, type: 'artist', name: 'cool_artist' },
        { id: 3, type: 'character', name: 'asuka langley' },
        { id: 4, type: 'parody', name: 'neon genesis evangelion' },
        { id: 5, type: 'language', name: 'english' },
      ],
    },
  ],
});

test('parseNHentaiJsonListing extracts manga metadata, tags, covers, pageCount', () => {
  const nh = loadNHentai();
  const posts = nh.parseNHentaiJsonListing(JSON_LISTING, SOURCE);
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.equal(p.id, 'nh_298547');
  assert.equal(p.mediaId, '1556093');
  assert.equal(p.title, 'Sample Manga');
  assert.equal(p.pageCount, 3);
  assert.equal(p.previewUrl, 'https://t.nhentai.net/galleries/1556093/thumb.jpg');
  assert.equal(p.sampleUrl, 'https://t.nhentai.net/galleries/1556093/cover.jpg');
  assert.equal(p.originalUrl, 'https://i.nhentai.net/galleries/1556093/1.jpg');
  assert.equal(p.score, 4520);
  assert.equal(p.rating, 'e');
  assert.equal(p.tags.artist[0], 'cool_artist');
  assert.equal(p.tags.character[0], 'asuka langley');
  assert.equal(p.tags.copyright[0], 'neon genesis evangelion');
  assert.equal(p.tags.general[0], 'big breasts');
  assert.ok(p.tags.meta.includes('manga'));
  assert.ok(p.tags.meta.includes('english'));
});

const HTML_LISTING = '<html><body>' +
  '<div class="gallery_item" data-tags="1 2 3">' +
  '<a href="/g/334455/" title="HTML Scraped Doujinshi">' +
  '<img data-src="https://i5.nhentaimg.com/018/zd5ew9kgoa/thumb.jpg" width="250" height="350"/>' +
  '<div class="caption">HTML Scraped Doujinshi</div>' +
  '</a></div>' +
  '</body></html>';

test('parseNHentaiHtmlListing extracts gallery cards as fallback', () => {
  const nh = loadNHentai();
  const posts = nh.parseNHentaiHtmlListing(HTML_LISTING, SOURCE);
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.equal(p.id, 'nh_334455');
  assert.equal(p.mediaId, 'zd5ew9kgoa');
  assert.equal(p.title, 'HTML Scraped Doujinshi');
  assert.equal(p.previewUrl, 'https://i5.nhentaimg.com/018/zd5ew9kgoa/thumb.jpg');
  assert.equal(p.sampleUrl, 'https://i5.nhentaimg.com/018/zd5ew9kgoa/cover.jpg');
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
  assert.equal(pages[0], 'https://i.nhentai.net/galleries/1556093/1.jpg');
  assert.equal(pages[1], 'https://i.nhentai.net/galleries/1556093/2.png');
  assert.equal(pages[2], 'https://i.nhentai.net/galleries/1556093/3.webp');
});

test('parseNHentaiGalleryPages parses pages from nhentaimg and nhentai HTML thumbnails', () => {
  const nh = loadNHentai();
  // Sitede 50 sayfa varken yalniz 2 thumbnail gelse bile load_pages ile tum 50 sayfa uretilmeli
  const xxxFullHtml = '<html><body>' +
    '<span class="text">Pages:</span><span class="tags"><a class="tag_btn"><span class="tag_name pages">50</span></a></span>' +
    '<input type="hidden" name="load_id" id="load_id" value="zd5ew9kgoa" />' +
    '<input type="hidden" name="load_pages" id="load_pages" value="50" />' +
    '<div class="gt_th"><a href="/g/703517/1/"><img data-src="https://i5.nhentaimg.com/018/zd5ew9kgoa/1t.jpg"/></a></div>' +
    '</body></html>';
  const fullPages = nh.parseNHentaiGalleryPages(xxxFullHtml, '703517');
  assert.equal(fullPages.length, 50);
  assert.equal(fullPages[0], 'https://i5.nhentaimg.com/018/zd5ew9kgoa/1.webp');
  assert.equal(fullPages[24], 'https://i5.nhentaimg.com/018/zd5ew9kgoa/25.webp');
  assert.equal(fullPages[49], 'https://i5.nhentaimg.com/018/zd5ew9kgoa/50.webp');

  const xxxHtml = '<html><body>' +
    '<div class="gt_th"><a href="/g/703517/1/"><img data-src="https://i5.nhentaimg.com/018/zd5ew9kgoa/1t.jpg"/></a></div>' +
    '<div class="gt_th"><a href="/g/703517/2/"><img data-src="https://i5.nhentaimg.com/018/zd5ew9kgoa/2t.jpg"/></a></div>' +
    '</body></html>';
  const xxxPages = nh.parseNHentaiGalleryPages(xxxHtml, '703517');
  assert.equal(xxxPages.length, 2);
  assert.equal(xxxPages[0], 'https://i5.nhentaimg.com/018/zd5ew9kgoa/1.webp');
  assert.equal(xxxPages[1], 'https://i5.nhentaimg.com/018/zd5ew9kgoa/2.webp');

  const netHtml = '<html><body><div id="thumbnail-container">' +
    '<div class="thumb-container"><a href="/g/123/1/"><img src="https://t2.nhentai.net/galleries/999/1t.jpg"/></a></div>' +
    '<div class="thumb-container"><a href="/g/123/2/"><img src="https://t.nhentai.net/galleries/999/2t.png"/></a></div>' +
    '</div></body></html>';
  const netPages = nh.parseNHentaiGalleryPages(netHtml, '123');
  assert.equal(netPages.length, 2);
  assert.equal(netPages[0], 'https://i.nhentai.net/galleries/999/1.jpg');
  assert.equal(netPages[1], 'https://i.nhentai.net/galleries/999/2.png');
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
  assert.equal(resolved[0], 'https://i1.nhentai.net/galleries/1556093/1.jpg');

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
  assert.equal(fallback[0], 'https://i1.nhentai.net/galleries/888/1.jpg');
  assert.equal(fallback[2], 'https://i1.nhentai.net/galleries/888/3.jpg');
});

test('parseNHentaiTagsFromHtml extracts categorized artist, character, parody, general tags', () => {
  const nh = loadNHentai();
  const sampleDetailHtml = '<html><body>' +
    '<div class="tag_container">' +
    '<a class="tag_btn" href="/artist/shindol/"><span class="tag_name">shindol</span><span class="tag_count">120</span></a>' +
    '<a class="tag_btn" href="/character/asuka-langley-soryu/"><span class="tag_name">asuka langley soryu</span><span class="tag_count">1.4K</span></a>' +
    '<a class="tag_btn" href="/parody/neon-genesis-evangelion/"><span class="tag_name">neon genesis evangelion</span><span class="tag_count">3K</span></a>' +
    '<a class="tag_btn" href="/tag/sole-female/"><span class="tag_name">sole female</span><span class="tag_count">115K</span></a>' +
    '<a class="tag_btn" href="/tag/big-breasts/"><span class="tag_name">big breasts</span><span class="tag_count">145K</span></a>' +
    '<a class="tag_btn" href="/language/english/"><span class="tag_name">english</span><span class="tag_count">108K</span></a>' +
    '</div></body></html>';

  const { tags, allTags } = nh.parseNHentaiTagsFromHtml(sampleDetailHtml);
  assert.equal(tags.artist[0], 'shindol');
  assert.equal(tags.character[0], 'asuka langley soryu');
  assert.equal(tags.copyright[0], 'neon genesis evangelion');
  assert.ok(tags.general.includes('sole female'));
  assert.ok(tags.general.includes('big breasts'));
  assert.ok(tags.meta.includes('english'));
  assert.equal(allTags.length, 6);
});

test('parseNHentaiTagsFromHtml handles real xxx detail markup (single quotes)', () => {
  const nh = loadNHentai();
  const realHtml = '<html><body>' +
    "<a class='tag_btn ' href='/artist/tachi-iyashi/'>" +
    "<span class='tag_name'>tachi iyashi</span><span class='tag_count '>33</span></a>" +
    "<a class='tag_btn ' href='/group/nunpokojin/'>" +
    "<span class='tag_name'>nunpokojin</span><span class='tag_count '>11</span></a>" +
    "<a class='tag_btn ' href='/tag/sole-female/'>" +
    "<span class='tag_name'>sole female</span><span class='tag_count '>216K</span></a>" +
    "<a class='tag_btn ' href='/language/english/'>" +
    "<span class='tag_name'>english</span><span class='tag_count '>143K</span></a>" +
    "<a class='tag_btn ' href='/category/doujinshi/'>" +
    "<span class='tag_name'>doujinshi</span><span class='tag_count '>539K</span></a>" +
    '</body></html>';

  const { tags, allTags } = nh.parseNHentaiTagsFromHtml(realHtml);
  assert.equal(tags.artist[0], 'tachi iyashi');
  assert.ok(tags.artist.includes('nunpokojin'));
  assert.ok(tags.general.includes('sole female'));
  assert.ok(tags.meta.includes('english'));
  assert.ok(tags.meta.includes('doujinshi'));
  assert.equal(allTags.length, 5);
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

test('resolveNHentaiGalleryDetail resolves pages and categorized tags together', async () => {
  const customFetch = async (url) => {
    if (url.includes('/g/703517/')) {
      return {
        ok: true,
        text: async () => '<html><body>' +
          '<span class="text">Pages:</span><span class="tags"><a class="tag_btn"><span class="tag_name pages">20</span></a></span>' +
          '<input type="hidden" name="load_id" id="load_id" value="testfolder" />' +
          '<div class="gt_th"><a href="/g/703517/1/"><img data-src="https://i5.nhentaimg.com/018/testfolder/1t.jpg"/></a></div>' +
          '<a class="tag_btn" href="/artist/cool-artist/"><span class="tag_name">cool artist</span></a>' +
          '<a class="tag_btn" href="/tag/milf/"><span class="tag_name">milf</span></a>' +
          '</body></html>',
      };
    }
    return { ok: false, status: 404 };
  };

  const nh = loadNHentai(customFetch);
  const detail = await nh.resolveNHentaiGalleryDetail({ id: 'nh_703517' });
  assert.equal(detail.pages.length, 20);
  assert.equal(detail.pages[0], 'https://i5.nhentaimg.com/018/testfolder/1.webp');
  assert.equal(detail.tags.artist[0], 'cool artist');
  assert.equal(detail.tags.general[0], 'milf');
  assert.ok(detail.allTags.includes('cool artist'));
  assert.ok(detail.allTags.includes('milf'));
});
