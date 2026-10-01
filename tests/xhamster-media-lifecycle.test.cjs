const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadXhamster() {
  const filename = path.resolve(__dirname, '../src/services/xhamster.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    URLSearchParams,
  }, { filename });
  return module.exports;
}

function loadMedia() {
  const mocks = {
    'react-native': { Platform: { OS: 'ios' } },
    '../services/proxyService': { proxyService: { proxyUrl: (u) => u } },
    '../services/storage': {},
    '../services/xvideos': {},
    '../services/xhamster': {},
    '../services/pornhub': {},
  };
  const filename = path.resolve(__dirname, '../src/utils/media.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => mocks[id] || {},
    Map, Set,
  }, { filename });
  return module.exports;
}

test('parseXhamsterListing converts AV1 trailer to H264 and omits 2-frame previewThumbs', () => {
  const { parseXhamsterListing } = loadXhamster();
  const html = `
    <div data-video-id="12345">
      <a data-role="thumb-link" href="/videos/test-video-12345" data-previewvideo="https://xhcdn.com/video_TPL_.av1.mp4&amp;token=abc">
        <img data-role="thumb-preview-img" srcset="https://xhcdn.com/thumb_240.jpg 240w, https://xhcdn.com/thumb_526.jpg 526w" src="https://xhcdn.com/thumb_240.jpg" alt="Test Video" />
      </a>
      <div data-role="video-duration">12:34</div>
      <div class="video-thumb-views">125K</div>
    </div>
  `;
  const posts = parseXhamsterListing(html, { id: 'xhamster', name: 'XHamster', baseUrl: 'https://xhamster.com' });
  assert.equal(posts.length, 1);
  const p = posts[0];
  // AV1 converted to H264
  assert.equal(p.previewVideoUrl, 'https://xhcdn.com/video_TPL_.h264.mp4&token=abc');
  // High-res (>=500w) thumb picked from srcset
  assert.equal(p.previewUrl, 'https://xhcdn.com/thumb_526.jpg');
  // No fake 2-frame previewThumbs toggling / pixelation
  assert.equal(p.previewThumbs, undefined);
  assert.equal(p.previewThumbUrl, undefined);
});

test('normalizeBooruMediaUrl normalizes XHamster AV1 to H264', () => {
  const { normalizeBooruMediaUrl, isUnsupportedOnIOS } = loadMedia();
  const av1Url = 'https://xhcdn.com/video.av1.mp4';
  const normalized = normalizeBooruMediaUrl(av1Url);
  assert.equal(normalized, 'https://xhcdn.com/video.h264.mp4');

  assert.equal(isUnsupportedOnIOS('https://xhcdn.com/video.av1.mp4'), true);
  assert.equal(isUnsupportedOnIOS('https://xhcdn.com/video.h264.mp4'), false);
  assert.equal(isUnsupportedOnIOS('https://cdn.test/video.webm'), true);
});

function loadPornhub() {
  const filename = path.resolve(__dirname, '../src/services/pornhub.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    URLSearchParams,
  }, { filename });
  return module.exports;
}

test('parsePornhubHtmlListing generates 8 sequential previewThumbs from poster URL', () => {
  const { parsePornhubHtmlListing } = loadPornhub();
  const html = `
    <li data-video-vkey="ph6012345">
      <a class="thumbnailTitle" title="Pornhub Test Video">Pornhub Test Video</a>
      <img class="videoThumb" src="https://ci.phncdn.com/videos/202401/10/446211231/thumbs_5/(m=eaAaGwObaaaa)(mh=...)1.jpg" data-poster="https://ci.phncdn.com/videos/202401/10/446211231/thumbs_5/(m=eaAaGwObaaaa)(mh=...)1.jpg" data-webm="https://ci.phncdn.com/videos/202401/10/446211231/preview.mp4" />
    </li>
  `;
  const posts = parsePornhubHtmlListing(html, { id: 'pornhub', name: 'Pornhub', baseUrl: 'https://pornhub.com' });
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.ok(p.previewThumbs && p.previewThumbs.length === 8);
  assert.equal(p.previewThumbs[0], 'https://ci.phncdn.com/videos/202401/10/446211231/thumbs_5/(m=eaAaGwObaaaa)(mh=...)1.jpg');
  assert.equal(p.previewThumbs[1], 'https://ci.phncdn.com/videos/202401/10/446211231/thumbs_5/(m=eaAaGwObaaaa)(mh=...)3.jpg');
  assert.equal(p.previewThumbs[7], 'https://ci.phncdn.com/videos/202401/10/446211231/thumbs_5/(m=eaAaGwObaaaa)(mh=...)15.jpg');
});

test('generatePornhubSequentialThumbs handles _medium, medium, hashes, default, and webp', () => {
  const { generatePornhubSequentialThumbs, mapPornhubVideoToPost } = loadPornhub();

  // 1. _medium with hash prefix
  const res1 = generatePornhubSequentialThumbs('https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/(m=eaSaaTBaaa)(mh=...)1_medium.jpg');
  assert.ok(res1 && res1.length === 8);
  assert.equal(res1[0], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/(m=eaSaaTBaaa)(mh=...)1_medium.jpg');
  assert.equal(res1[1], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/(m=eaSaaTBaaa)(mh=...)3_medium.jpg');
  assert.equal(res1[7], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/(m=eaSaaTBaaa)(mh=...)15_medium.jpg');

  // 2. simple 1_medium.jpg
  const res2 = generatePornhubSequentialThumbs('https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/1_medium.jpg');
  assert.ok(res2 && res2.length === 8);
  assert.equal(res2[1], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/3_medium.jpg');

  // 3. medium.jpg (symlink/alias on CDN)
  const res3 = generatePornhubSequentialThumbs('https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/medium.jpg');
  assert.ok(res3 && res3.length === 8);
  assert.equal(res3[0], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/1_medium.jpg');
  assert.equal(res3[1], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/3_medium.jpg');

  // 4. default.jpg
  const res4 = generatePornhubSequentialThumbs('https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/default.jpg');
  assert.ok(res4 && res4.length === 8);
  assert.equal(res4[1], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/3.jpg');

  // 5. mapPornhubVideoToPost produces 8 previewThumbs
  const post = mapPornhubVideoToPost({
    video_id: 'ph12345',
    title: 'Test',
    thumb: 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/(m=eaSaaTBaaa)(mh=...)1_medium.jpg',
  }, { id: 'pornhub', name: 'Pornhub', baseUrl: 'https://pornhub.com' });
  assert.ok(post);
  assert.ok(post.previewThumbs && post.previewThumbs.length === 8);
  assert.equal(post.previewThumbs[1], 'https://ci.phncdn.com/videos/202305/01/430889241/thumbs_5/(m=eaSaaTBaaa)(mh=...)3_medium.jpg');
});


