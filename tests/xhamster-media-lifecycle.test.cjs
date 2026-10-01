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
