const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

function setup(fetchWithFallback) {
  const calls = [];
  const load = createLoader({
    'react-native': { Platform: { OS: 'ios' } },
    '../services/proxyService': { proxyService: {
      fetchWithFallback: async (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        return fetchWithFallback(url, init);
      },
    } },
  });
  const { resolveRealDimensions } = load(path.resolve(__dirname, '../src/utils/media.ts'));
  return { resolveRealDimensions, calls };
}

test('video and gallery sources skip image-detail requests, including saved cards', async () => {
  const { resolveRealDimensions, calls } = setup(async () => new Response(''));
  for (const sourceId of ['pornhub', 'xvideos', 'xhamster', 'sexcom', 'redgifs', 'hentaihaven', 'nhentai']) {
    const result = await resolveRealDimensions({
      id: 'saved', sourceId, sourceLink: 'https://source.test/watch', sampleUrl: 'https://cdn.test/cover.jpg',
    });
    assert.equal(result, null);
  }
  assert.deepEqual(calls, []);
});

test('long whitespace on image detail pages does not stall file-size or dimension parsing', async () => {
  const whitespace = ' '.repeat(4096);
  const html = `<div>${whitespace}</div><p>1234x5678${whitespace}missing terminator</p><p>1280 x 960 px</p><p>850 KB</p>`;
  const { resolveRealDimensions, calls } = setup(async () => new Response(html));

  const start = performance.now();
  const result = await resolveRealDimensions({ sourceId: 'gelbooru', sourceLink: 'https://source.test/post/1' });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1500, `Parsing took ${elapsed.toFixed(0)} ms`);
  assert.deepEqual({ ...result }, { w: 1280, h: 960, bytes: 850 * 1024 });
  assert.deepEqual(calls, [{ url: 'https://source.test/post/1', method: 'GET' }]);
});

test('image details still use the MB value and fall back to the original image length when needed', async () => {
  const { resolveRealDimensions, calls } = setup(async (url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': '12345' } });
    if (url.endsWith('/1')) return new Response('<p>20 KB</p><p>2,4 MB</p><p>1280x960 px</p>');
    return new Response('<img id="image" width="640" height="480">');
  });
  const fromHtml = await resolveRealDimensions({ sourceId: 'gelbooru', sourceLink: 'https://source.test/post/1' });
  assert.deepEqual({ ...fromHtml }, { w: 1280, h: 960, bytes: Math.round(2.4 * 1024 * 1024) });
  const fromHead = await resolveRealDimensions({
    sourceId: 'gelbooru', sourceLink: 'https://source.test/post/2', originalUrl: 'https://cdn.test/photo.jpg',
  });
  assert.deepEqual({ ...fromHead }, { w: 640, h: 480, bytes: 12345 });
  assert.deepEqual(calls.at(-1), { url: 'https://cdn.test/photo.jpg', method: 'HEAD' });
});
