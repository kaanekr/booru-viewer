const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

function loadMedia(proxyUrl = (url) => url) {
  return createLoader({
    'react-native': { Platform: { OS: 'ios' } },
    '../services/proxyService': { proxyService: { proxyUrl } },
    '../services/xvideos': {},
    '../services/xhamster': {},
    '../services/pornhub': {},
  })(path.resolve(__dirname, '../src/utils/media.ts'));
}

// These four API paths returned 404; their embedded files on the active CDN
// returned 200 with image/jpeg or image/webp. Keep tests offline/deterministic.
const covers = [
  'c/z/i/s_0a94ce85036558e6.jpg',
  'c/z/i/s_f70c77a13ae3a244.jpg',
  'c/z/j/s_1a5d89bcf3f1daf2.jpg',
  'c/z/j/s_cf25bf969af02e40.webp',
];

test('repairs broken HentaiHaven API covers, including saved raw URLs', () => {
  const media = loadMedia();
  for (const filename of covers) {
    const raw = `https://himg.nl/images/hh/images/${filename}/s_poster.jpg`;
    const expected = `https://img.hentaihaven.xxx/images/${filename}`;
    assert.equal(media.normalizeBooruMediaUrl(raw), expected);
    assert.equal(media.getMediaUrl(raw), expected);
    assert.equal(media.getMediaHeaders(media.getMediaUrl(raw)).Referer, 'https://hentaihaven.xxx/');
    assert.equal(media.normalizeBooruMediaUrl(expected), expected);
  }
});

test('preserves cover query/fragment and repairs before proxy wrapping', () => {
  let proxyInput;
  const media = loadMedia((url) => {
    proxyInput = url;
    return `https://relay.test/?url=${encodeURIComponent(url)}`;
  });
  const raw = ` //himg.nl/images/hh/images/${covers[0]}/s_poster.jpg?v=2&token=abc#cover `;
  const expected = `https://img.hentaihaven.xxx/images/${covers[0]}?v=2&token=abc#cover`;
  assert.equal(media.getMediaUrl(raw), `https://relay.test/?url=${encodeURIComponent(expected)}`);
  assert.equal(proxyInput, expected);
  assert.equal(media.normalizeBooruMediaUrl(raw.trim().replace('//', 'http://')), expected);
});

test('leaves existing covers, episode thumbnails and unrelated hosts untouched', () => {
  const media = loadMedia();
  for (const url of [
    'https://img.hentaihaven.xxx/images/hh/z/f/s_cover.jpg',
    'https://coverlanyvd.org/storage/2026/09/23/sample/thumbnail.webp',
    'https://himg.nl/storage/sample/s_poster.jpg',
    `https://himg.nl.example.com/images/hh/images/${covers[0]}/s_poster.jpg`,
    `https://other.test/images/hh/images/${covers[0]}/s_poster.jpg`,
    'https://octopusmanifest.org/sample/playlist.m3u8',
  ]) {
    assert.equal(media.normalizeBooruMediaUrl(url), url);
  }
  assert.equal(media.normalizeBooruMediaUrl(undefined), '');
});
