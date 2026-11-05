const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadMedia(fetcher) {
  const calls = [];
  const mocks = {
    'react-native': { Platform: { OS: 'ios' } },
    '../services/proxyService': {
      proxyService: {
        proxyUrl: (u) => u,
        fetchWithFallback: async (url, init) => {
          calls.push({ url, init });
          return fetcher(url, init);
        },
      },
    },
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
  vm.runInNewContext(
    js,
    {
      module,
      exports: module.exports,
      require: (id) => mocks[id] || {},
      Map,
      Set,
      setTimeout,
      clearTimeout,
      AbortController,
    },
    { filename }
  );
  return { media: module.exports, calls };
}

// Live-verified shape: <video><source mp4 + webm> with double-slash paths.
const DETAIL = `<video style="width: 100%;" controls loop id="gelcomVideoPlayer">
  <source src="https://realbooru.com//images/e9/c6/e9c6bb87111427824588ea3fcca59b48.mp4" type="video/mp4" />
  <source src="https://realbooru.com//images/e9/c6/e9c6bb87111427824588ea3fcca59b48.webm" type="video/webm" />
</video>`;

test('parseRealbooruDetail prefers mp4 and normalizes double slashes', () => {
  const { media } = loadMedia(() => {
    throw new Error('no fetch expected');
  });
  const files = media.parseRealbooruDetail(DETAIL);
  assert.equal(files.mp4, 'https://realbooru.com/images/e9/c6/e9c6bb87111427824588ea3fcca59b48.mp4');
  assert.equal(files.webm, 'https://realbooru.com/images/e9/c6/e9c6bb87111427824588ea3fcca59b48.webm');
  assert.equal(files.image, '');
  const empty = media.parseRealbooruDetail('');
  assert.equal(empty.mp4, '');
  assert.equal(empty.webm, '');
  assert.equal(empty.image, '');
  const photo = media.parseRealbooruDetail('<html><body>photo only</body></html>');
  assert.equal(photo.mp4, '');
  assert.equal(photo.webm, '');
  assert.equal(photo.image, '');
});

test('parseRealbooruDetail falls back to the detail image for GIF posts', () => {
  const { media } = loadMedia(() => {
    throw new Error('no fetch expected');
  });
  const files = media.parseRealbooruDetail(
    '<div class="content"><img alt="gif" src="https://realbooru.com//images/65/d6/65d6d5876940b6a44981c2a014963d34.gif" /></div>'
  );
  assert.equal(files.mp4, '');
  assert.equal(files.webm, '');
  assert.equal(files.image, 'https://realbooru.com/images/65/d6/65d6d5876940b6a44981c2a014963d34.gif');
});

test('selectRealbooruPlayable prefers video, then the GIF image', () => {
  const { media } = loadMedia(() => {
    throw new Error('no fetch expected');
  });
  assert.equal(media.selectRealbooruPlayable({ mp4: 'a.mp4', webm: 'a.webm', image: 'a.gif' }), 'a.mp4');
  assert.equal(media.selectRealbooruPlayable({ mp4: '', webm: 'a.webm', image: 'a.gif' }), 'a.webm');
  assert.equal(media.selectRealbooruPlayable({ mp4: '', webm: '', image: 'a.gif' }), 'a.gif');
  assert.equal(media.selectRealbooruPlayable(null), '');
});

test('normalizeRealbooruFileUrl canonicalizes detail URLs', () => {
  const { media } = loadMedia(() => {
    throw new Error('no fetch expected');
  });
  assert.equal(
    media.normalizeRealbooruFileUrl('https://realbooru.com//images/e9/c6/f.mp4'),
    'https://realbooru.com/images/e9/c6/f.mp4'
  );
  assert.equal(media.normalizeRealbooruFileUrl(undefined), '');
  assert.equal(media.normalizeRealbooruFileUrl(''), '');
});

test('resolveRealbooruVideoUrls fetches once per post and prefers mp4', async () => {
  let fetches = 0;
  const { media, calls } = loadMedia(async () => {
    fetches++;
    return { ok: true, text: async () => DETAIL };
  });
  const post = { id: 'realbooru_1', sourceLink: 'https://realbooru.com/index.php?page=post&s=view&id=1' };
  const first = await media.resolveRealbooruVideoUrls(post);
  const second = await media.resolveRealbooruVideoUrls(post);
  assert.ok(first.mp4.endsWith('.mp4'));
  assert.equal(second.mp4, first.mp4);
  assert.equal(second.webm, first.webm);
  assert.equal(fetches, 1);
  assert.equal(calls[0].url, post.sourceLink);
  // Resolved mp4 wins over the list-scraped guess in viewer candidates.
  const candidates = media.getVideoCandidates({ sampleUrl: first.mp4, originalUrl: 'https://realbooru.com/images/x.jpg' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], first.mp4);
});

test('resolveRealbooruVideoUrls returns webm-only posts for the iOS upgrade flow', async () => {
  const { media } = loadMedia(async () => ({
    ok: true,
    text: async () => '<video><source src="https://realbooru.com//images/a/b/f.webm" type="video/webm" /></video>',
  }));
  const files = await media.resolveRealbooruVideoUrls({
    sourceLink: 'https://realbooru.com/index.php?page=post&s=view&id=2',
  });
  assert.equal(files.mp4, '');
  assert.ok(files.webm.endsWith('.webm'));
});

test('resolveRealbooruVideoUrls returns null without a fetchable detail page', async () => {
  const { media } = loadMedia(async () => ({ ok: false, status: 404 }));
  assert.equal(
    await media.resolveRealbooruVideoUrls({ sourceLink: 'https://realbooru.com/index.php?page=post&s=view&id=9' }),
    null
  );
  assert.equal(await media.resolveRealbooruVideoUrls({}), null);
  assert.equal(await media.resolveRealbooruVideoUrls({ sourceLink: 'not-a-url' }), null);
});

function loadBooruApi(html) {
  const { createLoader } = require('./helpers/load-typescript.cjs');
  const load = createLoader(
    {
      './sources': { DEFAULT_SOURCE: { id: 'realbooru', type: 'realbooru', baseUrl: 'https://realbooru.com' } },
      './proxyService': {
        proxyService: { fetchWithFallback: async () => ({ ok: true, text: async () => html }) },
      },
      './storage': { StorageService: { getBlacklistedTags: async () => [] } },
      '../utils/guards': {},
      './xvideos': {},
      './xhamster': {},
      './pornhub': {},
      './sexcom': {},
      './hentaihavens': {},
      './nhentai': {},
    },
    { console: { ...console, warn() {} } }
  );
  return new (load(path.resolve(__dirname, '../src/services/booruApi.ts')).BooruApiService)();
}

test('Realbooru resolver decodes legacy HTML-escaped detail links and does not cache temporary failures', async () => {
  let attempts = 0;
  const { media, calls } = loadMedia(async () => {
    if (++attempts === 1) return { ok: false, status: 503 };
    return { ok: true, text: async () => '<img src="https://realbooru.com//images/a/b/f.gif" />' };
  });
  const post = { sourceLink: 'https://realbooru.com/index.php?page=post&amp;s=view&amp;id=8' };
  assert.equal(await media.resolveRealbooruVideoUrls(post), null);
  assert.equal((await media.resolveRealbooruVideoUrls(post)).image, 'https://realbooru.com/images/a/b/f.gif');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://realbooru.com/index.php?page=post&s=view&id=8');
});

test('Realbooru resolver does not fetch an already-aborted page', async () => {
  const { media, calls } = loadMedia(async () => { throw new Error('unexpected fetch'); });
  const ctrl = new AbortController();
  ctrl.abort();
  assert.equal(await media.resolveRealbooruVideoUrls({ sourceLink: 'https://realbooru.com/index.php?page=post&s=view&id=8' }, ctrl.signal), null);
  assert.equal(calls.length, 0);
});

const thumb = (id, title) =>
  `<div class="col thumb" id="s${id}"><a id="p${id}" href="https://realbooru.com/index.php?page=post&amp;s=view&amp;id=${id}">` +
  `<img src="https://realbooru.com/thumbnails/ab/cd/thumbnail_abcd${id}.jpg" title="${title}" alt="Image: ${id}" /></a></div>`;

test('realbooru scrape keeps GIFs out of the video path (live tag shapes)', async () => {
  const api = loadBooruApi(
    thumb('1011629', 'animated, big breasts, gif, milf, pov') +
      thumb('1011719', '1girl, video, webm, sound, big breasts')
  );
  const source = { id: 'realbooru', name: 'Realbooru', type: 'realbooru', baseUrl: 'https://realbooru.com' };
  const posts = await api.fetchRealbooruPosts(source, 1, 42, '', false);
  assert.equal(posts.length, 2);
  const gif = posts.find((p) => p.id === 'realbooru_1011629');
  const video = posts.find((p) => p.id === 'realbooru_1011719');
  assert.equal(gif.fileExt, 'gif');
  assert.equal(gif.tags.meta.length, 0);
  assert.ok(gif.sampleUrl.endsWith('.jpg'));
  assert.ok(gif.originalUrl.endsWith('.gif'));
  assert.equal(video.fileExt, 'mp4');
  assert.ok(video.tags.meta.includes('video'));
  assert.ok(video.sampleUrl.endsWith('.mp4'));
});

function loadGifMedia() {
  const { createLoader } = require('./helpers/load-typescript.cjs');
  return createLoader()(path.resolve(__dirname, '../src/utils/gifMedia.ts'));
}

test('isGifMediaPost trusts the gif tag for extension-less Realbooru lists', () => {
  const { isGifMediaPost } = loadGifMedia();
  // Live shape: `animated, ..., gif, ...` with no `video` tag, while the
  // extension-less listing made the scraper guess `.mp4`.
  assert.equal(
    isGifMediaPost({
      sourceId: 'realbooru',
      fileExt: 'mp4',
      sampleUrl: 'https://realbooru.com/images/a/b/x.mp4',
      originalUrl: 'https://realbooru.com/images/a/b/x.mp4',
      tags: { general: ['animated', 'gif', 'milf'] },
    }),
    true
  );
  // A genuine video keeps its video path.
  assert.equal(
    isGifMediaPost({
      sourceId: 'realbooru',
      fileExt: 'mp4',
      sampleUrl: 'https://realbooru.com/images/a/b/x.mp4',
      tags: { general: ['video', 'webm', 'sound'] },
    }),
    false
  );
  // Tagged both ways: the video tag wins, the player stays available.
  assert.equal(isGifMediaPost({ sourceId: 'realbooru', tags: { general: ['gif', 'video'] } }), false);
  // A known extension or a detail-resolved .gif short-circuits everything.
  assert.equal(isGifMediaPost({ sourceId: 'gelbooru', fileExt: 'gif' }), true);
  assert.equal(
    isGifMediaPost({ sourceId: 'realbooru', fileExt: 'mp4', tags: { general: [] } }, 'https://realbooru.com/images/a/b/x.gif'),
    true
  );
  assert.equal(isGifMediaPost(null), false);
  assert.equal(isGifMediaPost(undefined), false);
  assert.equal(isGifMediaPost({ fileExt: 'gif' }, 'https://realbooru.com/images/a/b/f.mp4'), false);
  assert.equal(isGifMediaPost({ sourceId: 'realbooru', tags: { general: ['Animated', 'GIF'] } }), true);
});
