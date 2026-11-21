const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createLoader } = require('./helpers/load-typescript.cjs');
const lruCache = createLoader()(path.resolve(__dirname, '../src/utils/lruCache.ts'));

// Gercek media.ts yuklenir; yalnizca platform + modul baglari mocklanir.
// AVFoundation -11828 regresyonu: cozulmus webm, oynatilabilir aday varken
// birincil secilmemeli (sample MP4 + original WebM vakasi).
function loadMedia(platformOS) {
  const filename = path.resolve(__dirname, '../src/utils/media.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (id === 'react-native') return { Platform: { OS: platformOS } };
      if (id === '../services/proxyService') return {};
      if (id === '../services/storage') return {};
      if (id === '../services/xvideos') return {};
      if (id === '../services/xhamster') return {};
      if (id === '../services/pornhub') return {};
      if (id === './postIdentity') return { getPostKey: () => '' };
      if (id === './lruCache') return lruCache;
      if (id === './guards') return {
        urlEndsWith: (url, ...suffixes) => {
          if (typeof url !== 'string') return false;
          const clean = url.split(/[?#]/)[0].toLowerCase();
          return suffixes.some((suffix) => clean.endsWith(suffix));
        },
      };
      throw new Error('Unexpected dependency: ' + id);
    },
    console: { warn() {} },
    setTimeout, clearTimeout,
  }, { filename });
  return module.exports;
}

const MP4 = 'https://cdn.test/a-sample.mp4';
const WEBM = 'https://cdn.test/a-original.webm';

test('resolved webm never wins over a playable candidate on iOS (realbooru -11828)', () => {
  const media = loadMedia('ios');
  const candidates = media.getVideoCandidates({ sampleUrl: MP4, originalUrl: WEBM });
  assert.equal(candidates[0], MP4);
  const primary = media.selectPrimaryVideoCandidate(WEBM, candidates, WEBM);
  assert.equal(primary, MP4);
});

test('webm-only posts keep webm primary for the upgrade flow', () => {
  const media = loadMedia('ios');
  const candidates = media.getVideoCandidates({ sampleUrl: 'https://cdn.test/a.jpg', originalUrl: WEBM });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], WEBM);
  assert.equal(media.selectPrimaryVideoCandidate(WEBM, candidates, WEBM), WEBM);
});

test('playable resolved original stays primary', () => {
  const media = loadMedia('ios');
  const candidates = media.getVideoCandidates({ sampleUrl: MP4, originalUrl: WEBM });
  assert.equal(media.selectPrimaryVideoCandidate(MP4, candidates, WEBM), MP4);
});

test('no resolved url falls back to best candidate', () => {
  const media = loadMedia('ios');
  const candidates = media.getVideoCandidates({ sampleUrl: MP4, originalUrl: WEBM });
  assert.equal(media.selectPrimaryVideoCandidate(null, candidates, WEBM), MP4);
  assert.equal(media.selectPrimaryVideoCandidate('', [], 'https://cdn.test/f.jpg'), 'https://cdn.test/f.jpg');
});

test('android keeps webm resolved primary (ExoPlayer plays webm)', () => {
  const media = loadMedia('android');
  assert.equal(media.selectPrimaryVideoCandidate(WEBM, [WEBM], WEBM), WEBM);
});
