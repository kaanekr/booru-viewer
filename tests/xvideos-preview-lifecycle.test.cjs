const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { parseXVideosListing } = createLoader()(path.resolve(__dirname, '../src/services/xvideos.ts'));
const source = { id: 'xvideos', name: 'XVideos', baseUrl: 'https://www.xvideos.com' };

test('classic XVideos template thumbnails get a real static cover and decoded preview URL', () => {
  const html = `<div id="video_example" data-id="123"><a href="/video.example/test"><img data-src="//cdn.test/thumb_THUMBNUM.jpg" data-pvv="//cdn.test/clip.mp4?token=abc&amp;expires=123" /></a></div>`;
  const [post] = parseXVideosListing(html, source);
  assert.equal(post.previewUrl, 'https://cdn.test/thumb_1.jpg');
  assert.equal(post.sampleUrl, post.previewUrl);
  assert.equal(post.previewVideoUrl, 'https://cdn.test/clip.mp4?token=abc&expires=123');
  assert.equal(post.previewThumbs.length, 8);
  assert.ok(post.previewThumbs.every((url) => !url.includes('THUMBNUM')));
});

test('new XVideos cards normalize template covers and relative preview clips too', () => {
  const html = `<div id="video-thumb-example" data-video='{"id":123,"encodedId":"example","previewVideo":"/previews/clip.mp4"}'><a href="/video.example/test"><img data-src="//cdn.test/thumb_THUMBNUM.jpg" /></a></div>`;
  const [post] = parseXVideosListing(html, source);
  assert.equal(post.previewUrl, 'https://cdn.test/thumb_1.jpg');
  assert.equal(post.previewVideoUrl, 'https://www.xvideos.com/previews/clip.mp4');
  assert.equal(post.previewThumbs.length, 8);
});
