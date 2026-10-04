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

  const search = nh.buildNHentaiSearchCandidates('https://nhentai.xxx/', 2, 'genshin impact');
  assert.equal(search[0], 'https://nhentai.xxx/search/?q=genshin%20impact&page=2');
  assert.equal(search[1], 'https://nhentai.xxx/api/galleries/search?query=genshin%20impact&page=2');
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
    if (url.includes('/api/gallery/298547')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          media_id: '1556093',
          images: { pages: [{ t: 'j' }, { t: 'j' }] },
        }),
      };
    }
    return { ok: false, status: 403 };
  };

  const nh = loadNHentai(customFetch);
  const resolved = await nh.resolveNHentaiPages({ id: 'nh_298547' });
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0], 'https://i.nhentai.net/galleries/1556093/1.jpg');

  // Synthetic fallback when network fails but mediaId + pageCount exist
  const nhOffline = loadNHentai(async () => ({ ok: false, status: 500 }));
  const fallback = await nhOffline.resolveNHentaiPages({
    id: 'nh_999',
    mediaId: '888',
    pageCount: 3,
  });
  assert.equal(fallback.length, 3);
  assert.equal(fallback[0], 'https://i.nhentai.net/galleries/888/1.jpg');
  assert.equal(fallback[2], 'https://i.nhentai.net/galleries/888/3.jpg');
});
