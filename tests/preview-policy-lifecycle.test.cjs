const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { createLoader } = require('./helpers/load-typescript.cjs');
const helper = createLoader()(path.resolve(__dirname, '../src/utils/gridPreviewMedia.ts'));
const picture = 'https://cdn.test/cover.jpg';
const clip = 'https://cdn.test/preview.mp4';
const makePost = (extra = {}) => ({ previewUrl: picture, sampleUrl: picture, originalUrl: '', ...extra });

test('shared preview policy covers representative metadata for every configured provider (not live availability)', () => {
  const { AVAILABLE_SOURCES } = createLoader()(path.resolve(__dirname, '../src/services/sources.ts'));
  const cases = {
    gelbooru: makePost({ sampleUrl: clip }), rule34: makePost({ sampleUrl: clip }),
    danbooru: makePost({ sampleUrl: clip }), realbooru: makePost({ sampleUrl: clip }),
    yandere: makePost(), cumst: makePost({ sampleUrl: clip }),
    redgifs: makePost({ previewVideoUrl: clip }), xvideos: makePost({ previewVideoUrl: clip }),
    xhamster: makePost({ previewVideoUrl: clip }), sexcom: makePost({ previewVideoUrl: clip }),
    pornhub: makePost({ previewThumbs: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] }),
    hentaihaven: makePost(), nhentai: makePost(),
  };
  assert.deepEqual(Object.keys(cases).sort(), Array.from(AVAILABLE_SOURCES, (s) => s.id).sort());
  for (const [source, post] of Object.entries(cases)) {
    const videos = helper.getGridPreviewVideoCandidates(post, 'ios');
    const frames = helper.getGridPreviewFrames(post);
    if (['yandere', 'hentaihaven', 'nhentai'].includes(source)) assert.equal(videos.length + frames.length, 0, source);
    else assert.ok(videos.length + frames.length > 0, source);
  }
});

test('iOS skips a WebM preview but can use a supplied MP4 sample; Android retains both', () => {
  const post = makePost({ previewVideoUrl: 'https://cdn.test/clip.webm', sampleUrl: clip });
  assert.deepEqual(Array.from(helper.getGridPreviewVideoCandidates(post, 'ios')), [clip]);
  assert.equal(helper.getGridPreviewVideoCandidates(post, 'android').length, 2);
});

test('HTML, images, unsafe schemes and unsupported AV1 cannot become iOS video previews', () => {
  for (const previewVideoUrl of [picture, 'https://cdn.test/view.html', 'javascript:alert(1)', 'https://cdn.test/preview.av1.mp4']) {
    assert.equal(helper.getGridPreviewVideoCandidates(makePost({ previewVideoUrl }), 'ios').length, 0);
  }
});

test('signed URLs decode HTML ampersands, keep query parameters and resolve protocol-relative URLs', () => {
  const post = makePost({ previewVideoUrl: '//cdn.test/preview.mp4?token=abc&amp;expires=123' });
  assert.equal(helper.getGridPreviewVideoCandidates(post, 'ios')[0], 'https://cdn.test/preview.mp4?token=abc&expires=123');
});

test('full originals are not fetched automatically just because a post is marked video', () => {
  const post = makePost({ originalUrl: 'https://cdn.test/full.mp4' });
  assert.equal(helper.getGridPreviewVideoCandidates(post, 'ios').length, 0);
  assert.equal(helper.getGridPreviewVideoCandidates(post, 'ios', true)[0], post.originalUrl);
});

test('a full attachment aliased into sample/preview does not bypass the manual-original guard', () => {
  const full = 'https://cdn.test/full.mp4';
  for (const post of [makePost({ sampleUrl: full, originalUrl: full }), makePost({ previewUrl: full, sampleUrl: full, originalUrl: full })]) {
    assert.equal(helper.getGridPreviewVideoCandidates(post, 'ios').length, 0);
    assert.deepEqual(Array.from(helper.getGridPreviewVideoCandidates(post, 'ios', true)), [full]);
  }
  // An explicitly supplied listing clip remains eligible even if the provider
  // also happens to call it the original (e.g. short RedGifs clips).
  assert.deepEqual(Array.from(helper.getGridPreviewVideoCandidates(makePost({ previewVideoUrl: full, originalUrl: full }), 'ios')), [full]);
});

test('frame fallback deduplicates images and supports a sample GIF without a native player', () => {
  const frames = helper.getGridPreviewFrames(makePost({ previewThumbs: [picture, picture, clip, null], sampleUrl: 'https://cdn.test/sample.gif' }));
  assert.deepEqual(Array.from(frames), [picture, 'https://cdn.test/sample.gif']);
});

test('a Realbooru post tagged gif never reaches the motion preview path', () => {
  // Extension-less listing: the scraper guessed .mp4, but the tags say GIF.
  const post = makePost({
    sampleUrl: 'https://realbooru.com/images/a/b/x.mp4',
    originalUrl: 'https://realbooru.com/images/a/b/x.mp4',
    sourceId: 'realbooru',
    tags: { general: ['animated', 'gif'] },
  });
  assert.equal(helper.getGridPreviewVideoCandidates(post, 'ios').length, 0);
  assert.equal(helper.getGridPreviewVideoCandidates(post, 'ios', true).length, 0);
  // The same shape without the gif tag still previews as motion video.
  const video = makePost({
    sampleUrl: 'https://realbooru.com/images/a/b/x.mp4',
    originalUrl: '',
    sourceId: 'realbooru',
    tags: { general: ['video', 'sound'] },
  });
  assert.deepEqual(Array.from(helper.getGridPreviewVideoCandidates(video, 'ios')), [video.sampleUrl]);
});

test('one failed file does not disable its CDN and failures expire for later user retry', () => {
  let now = 1000;
  const load = createLoader({ react: React }, { Date: class extends Date { static now() { return now; } } });
  const policy = load(path.resolve(__dirname, '../src/utils/gridPreviews.ts'));
  policy.markPreviewFailure(clip);
  assert.equal(policy.isPreviewBlocked(clip), true);
  assert.equal(policy.isPreviewBlocked('https://cdn.test/other.mp4'), false);
  now += policy.PREVIEW_RETRY_DELAY_MS + 1;
  assert.equal(policy.isPreviewBlocked(clip), false);
});

test('both focus hooks release pending debounce timers on unmount', async () => {
  const { create, act } = require('react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let id = 0; const timers = new Map();
  const policy = createLoader({ react: React }, {
    setTimeout: (fn) => { const key = ++id; timers.set(key, fn); return key; },
    clearTimeout: (key) => timers.delete(key),
  })(path.resolve(__dirname, '../src/utils/gridVisibility.ts'));
  let many, one;
  function Harness() {
    [, many] = policy.useFocusedCardIds();
    [, one] = policy.useFocusedCardId();
    return null;
  }
  let root;
  await act(async () => { root = create(React.createElement(Harness)); });
  const layouts = new Map([['a', { y: 0, h: 100 }]]);
  many(layouts, 0, 500); one(layouts, 0, 500);
  assert.equal(timers.size, 2);
  await act(async () => root.unmount());
  assert.equal(timers.size, 0);
});
