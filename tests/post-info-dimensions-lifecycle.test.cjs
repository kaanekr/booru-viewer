const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

const gelbooruPage = (id) => `https://gelbooru.com/index.php?page=post&s=view&id=${id}`;

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
  const { resolveRealDimensions, resolveGelbooruOriginalUrl } = load(path.resolve(__dirname, '../src/utils/media.ts'));
  return { resolveRealDimensions, resolveGelbooruOriginalUrl, calls };
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
  const result = await resolveRealDimensions({ sourceId: 'gelbooru', sourceLink: gelbooruPage(1) });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1500, `Parsing took ${elapsed.toFixed(0)} ms`);
  assert.deepEqual({ ...result }, { w: 1280, h: 960, bytes: 850 * 1024 });
  assert.deepEqual(calls, [{ url: gelbooruPage(1), method: 'GET' }]);
});

test('image details still use the MB value and fall back to the original image length when needed', async () => {
  const { resolveRealDimensions, calls } = setup(async (url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': '12345' } });
    if (url === gelbooruPage(1)) return new Response('<p>20 KB</p><p>2,4 MB</p><p>1280x960 px</p>');
    return new Response('<img id="image" width="640" height="480">');
  });
  const fromHtml = await resolveRealDimensions({ sourceId: 'gelbooru', sourceLink: gelbooruPage(1) });
  assert.deepEqual({ ...fromHtml }, { w: 1280, h: 960, bytes: Math.round(2.4 * 1024 * 1024) });
  const fromHead = await resolveRealDimensions({
    sourceId: 'gelbooru', sourceLink: gelbooruPage(2), originalUrl: 'https://cdn.test/photo.jpg',
  });
  assert.deepEqual({ ...fromHead }, { w: 640, h: 480, bytes: 12345 });
  assert.deepEqual(calls.at(-1), { url: 'https://cdn.test/photo.jpg', method: 'HEAD' });
});

test('Gelbooru resolves each post on its own page when posts share a Pixiv source', async () => {
  const pixivLink = 'https://www.pixiv.net/en/artworks/12345';
  const pixivLogo = 'https://s.pximg.net/common/images/services/pixiv.png';
  const originals = {
    [gelbooruPage(10)]: 'https://img4.gelbooru.com/images/aa/bb/first.jpeg',
    [gelbooruPage(11)]: 'https://img4.gelbooru.com//images/aa/bb/second.png',
  };
  const { resolveGelbooruOriginalUrl, resolveRealDimensions, calls } = setup(async (url) => {
    const image = url === gelbooruPage(10)
      ? `<a href="${originals[url]}">Original</a>`
      : `<meta property="og:image" content="${originals[url]}">`;
    return new Response(`<a href="${pixivLogo}">Pixiv</a>${image}<p>Size: 1280 x 960</p><p>850 KB</p>`);
  });
  const post = { id: '10', sourceId: 'gelbooru', sourceLink: pixivLink };
  const saved = { ...post, id: 'gelbooru_11' };

  assert.equal(await resolveGelbooruOriginalUrl(post), originals[gelbooruPage(10)]);
  assert.equal(await resolveGelbooruOriginalUrl(saved), originals[gelbooruPage(11)]);
  assert.deepEqual({ ...await resolveRealDimensions(saved) }, { w: 1280, h: 960, bytes: 850 * 1024 });
  assert.deepEqual(calls.map(({ url }) => url), [gelbooruPage(10), gelbooruPage(11), gelbooruPage(11)]);
});

test('Gelbooru skips external attribution if the post page cannot be identified', async () => {
  const { resolveGelbooruOriginalUrl, resolveRealDimensions, calls } = setup(async () => new Response(''));
  const post = {
    id: 'gelbooru_legacy', sourceId: 'gelbooru', sourceLink: 'https://www.pixiv.net/en/artworks/12345',
    originalUrl: 'https://img4.gelbooru.com/samples/aa/bb/sample.jpg',
    sampleUrl: 'https://img4.gelbooru.com/samples/aa/bb/sample.jpg',
  };
  assert.equal(await resolveGelbooruOriginalUrl(post), post.sampleUrl);
  assert.equal(await resolveRealDimensions(post), null);
  assert.deepEqual(calls, []);
});
