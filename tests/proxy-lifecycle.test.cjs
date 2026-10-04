const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Gercek proxyService yuklenir; storage baglantisi mocklanir.
// TLS kirilgan host listesi + workersiz davranis kilitlenir.
function loadProxy() {
  const filename = path.resolve(__dirname, '../src/services/proxyService.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (id === './storage') return {};
      throw new Error('Unexpected dependency: ' + id);
    },
  }, { filename });
  return module.exports.proxyService;
}

test('xvideos and rule34 cdn hosts are tls-fragile', () => {
  const proxy = loadProxy();
  assert.equal(proxy.isTlsFragileUrl('https://thumb-cdn77.xvideos-cdn.com/35294e1d/6/preview.mp4'), true);
  assert.equal(proxy.isTlsFragileUrl('https://mp4-cdn77.xvideos-cdn.com/79124b6c/6/mp4_sd.mp4?secure=abc,123'), true);
  assert.equal(proxy.isTlsFragileUrl('https://thumbs-gcore.xvideos-cdn.com/d0d64988/6/preview.mp4'), true);
  assert.equal(proxy.isTlsFragileUrl('https://api-cdn-mp4.rule34.xxx/x.mp4'), true);
  assert.equal(proxy.isTlsFragileUrl('https://videos2.sex.com/1040312/video.m3u8'), false);
  assert.equal(proxy.isTlsFragileUrl('https://images.sxccdn.com/videos/1/288/thumbnail.1.jpg.webp'), false);
  assert.equal(proxy.isTlsFragileUrl(''), false);
  assert.equal(proxy.isTlsFragileUrl(undefined), false);
});

test('proxied worker url still matches fragile host through encoding', () => {
  const proxy = loadProxy();
  const raw = 'https://thumb-cdn77.xvideos-cdn.com/35294e1d/6/preview.mp4';
  assert.equal(proxy.isTlsFragileUrl('https://worker.test/?url=' + encodeURIComponent(raw)), true);
});

test('without worker everything stays direct', () => {
  const proxy = loadProxy();
  assert.equal(proxy.hasWorker(), false);
  const raw = 'https://thumb-cdn77.xvideos-cdn.com/35294e1d/6/preview.mp4';
  assert.equal(proxy.proxyUrl(raw), raw);
  assert.equal(proxy.forceProxyUrl(raw), raw);
  assert.equal(proxy.isProxiedUrl(raw), false);
});
