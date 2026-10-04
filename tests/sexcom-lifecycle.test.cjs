const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Gercek sexcom.ts yuklenir; tip importu derlemede silinir, modul bagimsizdir.
function loadSexCom() {
  const filename = path.resolve(__dirname, '../src/services/sexcom.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: (id) => {
      if (id === './proxyService') return {};
      throw new Error('sexcom must be UI-dependency-free, got: ' + id);
    },
  }, { filename });
  return module.exports;
}

const SOURCE = { id: 'sexcom', name: 'Sex.com', baseUrl: 'https://www.sex.com', type: 'sexcom' };

function cardHtml(o) {
  return '<div data-testid=\"video-card\" data-analytics-video_id=\"' + o.id + '\" class=\"w-full video-card\">' +
    '<a data-testid=\"video-link\" draggable=\"false\" href=\"/en/videos/' + o.id + '\">' +
    '<div class=\"relative aspect-16/9\">' +
    '<div data-testid=\"static-image-picture\">' +
    '<img alt=\"' + o.title + '\" decoding=\"async\" srcSet=\"https://images.sxccdn.com/videos/' + o.id + '/288/thumbnail.0000012.jpg.webp 288w\" src=\"https://images.sxccdn.com/videos/' + o.id + '/288/thumbnail.0000012.jpg.webp\"/>' +
    '</div>' +
    '<div><div><time>' + o.duration + '</time></div></div>' +
    '<video src=\"' + o.preview + '\" preload=\"none\" data-id=\"' + o.id + '\" data-title=\"' + o.title + '\" data-state=\"paused\"></video>' +
    '</div></a>' +
    '<div><div>' +
    (o.channel ? '<div><a data-testid=\"video-link-to-source-channel\" href=\"/en/channels/600\">' + o.channel + '</a></div>' : '') +
    '<div><div data-testid=\"view-count\"><svg viewBox=\"0 0 16 10\"><path d=\"M8 0\"></path></svg><span>' + o.views + '</span></div>' +
    (o.rating ? '<span><svg viewBox=\"0 0 25 24\"><path d=\"M1 2\"></path></svg>' + o.rating + '%</span>' : '') +
    '</div></div>' +
    '<a data-testid=\"video-link\" title=\"' + o.title + '\" href=\"/en/videos/' + o.id + '\">' + o.title + '</a>' +
    '</div></div>';
}

const LISTING = '<html><body>' + cardHtml({
  id: '1040312', title: 'Sunset Beach Walk', duration: '10:01',
  preview: 'https://videos2.sex.com/1040312/preview_240p.mp4',
  channel: 'Ocean Channel', views: '2.4K', rating: '98',
}) + cardHtml({
  id: '78466', title: 'Mountain Hike', duration: '5:33',
  preview: 'https://videos1.sex.com/78466/preview_240p.mp4',
  channel: '', views: '&lt;1K', rating: '',
}) + '</body></html>';

test('parses cards with thumb, preview mp4, duration, channel, views and rating', () => {
  const sx = loadSexCom();
  const posts = sx.parseSexComListing(LISTING, SOURCE);
  assert.equal(posts.length, 2);
  const first = posts[0];
  assert.equal(first.id, 'sx_1040312');
  assert.equal(first.title, 'Sunset Beach Walk');
  assert.equal(first.previewUrl, 'https://images.sxccdn.com/videos/1040312/288/thumbnail.0000012.jpg.webp');
  assert.equal(first.previewVideoUrl, 'https://videos2.sex.com/1040312/preview_240p.mp4');
  assert.equal(first.sampleUrl, 'https://videos2.sex.com/1040312/preview_240p.mp4');
  assert.equal(first.originalUrl, '');
  assert.equal(first.sourceLink, 'https://www.sex.com/en/videos/1040312');
  assert.equal(first.fileExt, 'mp4');
  assert.equal(first.aspectRatio, 16 / 9);
  assert.equal(first.score, 2400);
  assert.equal(first.tags.artist.length, 1);
  assert.equal(first.tags.artist[0], 'Ocean Channel');
  assert.ok(first.tags.general.includes('duration:10:01'));
  assert.ok(first.tags.general.includes('views:2.4K'));
  assert.ok(first.tags.general.includes('rating:98%'));
  assert.ok(first.tags.meta.includes('video'));
  const second = posts[1];
  assert.equal(second.id, 'sx_78466');
  assert.equal(second.score, 1000);
  assert.equal(second.tags.artist.length, 0);
});

test('skips cards without id or media and dedupes repeats', () => {
  const sx = loadSexCom();
  const noId = '<div data-testid=\"video-card\"><a href=\"/en/videos/1\">x</a></div>';
  assert.equal(sx.parseSexComListing(noId, SOURCE).length, 0);
  const noMedia = '<div data-testid=\"video-card\" data-analytics-video_id=\"5\"><a href=\"/en/videos/5\">x</a></div>';
  assert.equal(sx.parseSexComListing(noMedia, SOURCE).length, 0);
  assert.equal(sx.parseSexComListing(LISTING + LISTING, SOURCE).length, 2);
  assert.equal(sx.parseSexComListing('', SOURCE).length, 0);
});

test('views counter parses K/M/B units', () => {
  const sx = loadSexCom();
  assert.equal(sx.parseSexComViewsCount('850'), 850);
  assert.equal(sx.parseSexComViewsCount('2.4K'), 2400);
  assert.equal(sx.parseSexComViewsCount('1.2M'), 1200000);
  assert.equal(sx.parseSexComViewsCount('&lt;1K'), 1000);
  assert.equal(sx.parseSexComViewsCount(''), 0);
  assert.equal(sx.parseSexComViewsCount(undefined), 0);
});

test('builds feed and search urls with paging', () => {
  const sx = loadSexCom();
  assert.equal(sx.buildSexComSearchCandidates('https://www.sex.com', 1, '')[0], 'https://www.sex.com/en/videos');
  assert.equal(sx.buildSexComSearchCandidates('https://www.sex.com', 3, '')[0], 'https://www.sex.com/en/videos?page=3');
  assert.equal(sx.buildSexComSearchCandidates('https://www.sex.com', 1, 'beach walk')[0], 'https://www.sex.com/en/videos?search=beach%20walk');
  assert.equal(sx.buildSexComSearchCandidates('https://www.sex.com/', 4, 'beach')[0], 'https://www.sex.com/en/videos?page=4&search=beach');
});

const DETAIL = '<html><head><script type=\"application/ld+json\">' +
  '{\"@context\":\"https://schema.org\",\"@type\":\"VideoObject\",\"name\":\"Sunset Beach Walk\",' +
  '\"thumbnailUrl\":\"https://images.sxccdn.com/videos/1040312/908/thumbnail.0000012.jpg.jpeg\",' +
  '\"uploadDate\":\"2026-08-25T16:00:13Z\",\"duration\":\"P0Y0M0DT0H10M1S\",' +
  '\"contentUrl\":\"https://videos2.sex.com/1040312/video.m3u8\"}' +
  '</script></head><body>' +
  '<video src=\"https://videos2.sex.com/1040312/preview_240p.mp4\"></video>' +
  '</body></html>';

test('parses detail json-ld into hls, thumb, title and duration', () => {
  const sx = loadSexCom();
  const files = sx.parseSexComDetail(DETAIL);
  assert.equal(files.hls, 'https://videos2.sex.com/1040312/video.m3u8');
  assert.equal(files.thumb, 'https://images.sxccdn.com/videos/1040312/908/thumbnail.0000012.jpg.jpeg');
  assert.equal(files.title, 'Sunset Beach Walk');
  assert.equal(files.durationSec, 601);
  assert.equal(files.mp4, 'https://videos2.sex.com/1040312/preview_240p.mp4');
  const empty = sx.parseSexComDetail('');
  assert.equal(empty.hls, '');
  assert.equal(empty.mp4, '');
});

test('iso durations parse, garbage returns null', () => {
  const sx = loadSexCom();
  assert.equal(sx.parseSexComISODuration('P0Y0M0DT0H10M1S'), 601);
  assert.equal(sx.parseSexComISODuration('PT5M33S'), 333);
  assert.equal(sx.parseSexComISODuration('garbage'), null);
  assert.equal(sx.parseSexComISODuration(''), null);
  assert.equal(sx.parseSexComISODuration(undefined), null);
});

const PREMIUM_DETAIL = '<html><head><script type="application/ld+json">' +
  '{"@context":"https://schema.org","@type":"VideoObject","name":"Premium Clip",' +
  '"thumbnailUrl":"https://images.sxccdn.com/videos/978584/908/poster.jpeg",' +
  '"uploadDate":"2025-10-28T14:10:59Z","duration":"P0Y0M0DT0H0M1921S",' +
  '"contentUrl":"https://premium-videos2.sex.com/978584/video.m3u8"}' +
  '</script></head><body>' +
  '<video src="https://videos2.sex.com/978584/preview_240p.mp4"></video>' +
  '</body></html>';

test('premium-locked hls is flagged and falls back to preview mp4', () => {
  const sx = loadSexCom();
  const files = sx.parseSexComDetail(PREMIUM_DETAIL);
  assert.equal(files.hls, 'https://premium-videos2.sex.com/978584/video.m3u8');
  assert.equal(files.premium, true);
  assert.equal(sx.selectSexComPlayable(files), 'https://videos2.sex.com/978584/preview_240p.mp4');
});

test('playable selection prefers hls, then mp4, null when empty', () => {
  const sx = loadSexCom();
  assert.equal(sx.selectSexComPlayable(null), null);
  assert.equal(
    sx.selectSexComPlayable({ hls: 'https://videos2.sex.com/1/video.m3u8', mp4: 'https://videos2.sex.com/1/preview_240p.mp4', thumb: '', premium: false }),
    'https://videos2.sex.com/1/video.m3u8'
  );
  assert.equal(
    sx.selectSexComPlayable({ hls: '', mp4: 'https://videos2.sex.com/1/preview_240p.mp4', thumb: '', premium: false }),
    'https://videos2.sex.com/1/preview_240p.mp4'
  );
  assert.equal(
    sx.selectSexComPlayable({ hls: 'https://premium-videos2.sex.com/1/video.m3u8', mp4: '', thumb: '', premium: true }),
    null
  );
});

test('mp4 contentUrl is used directly', () => {
  const sx = loadSexCom();
  const files = sx.parseSexComDetail(
    '<html><head><script type="application/ld+json">{"@type":"VideoObject",' +
    '"contentUrl":"https://videos2.sex.com/5/video_720p.mp4"}</script></head><body></body></html>'
  );
  assert.equal(files.hls, '');
  assert.equal(files.premium, false);
  assert.equal(files.mp4, 'https://videos2.sex.com/5/video_720p.mp4');
  assert.equal(sx.selectSexComPlayable(files), 'https://videos2.sex.com/5/video_720p.mp4');
});

test('poster.webp covers parse when no thumbnail frames exist', () => {
  const sx = loadSexCom();
  const html = '<html><body>' +
    '<div data-testid="video-card" data-analytics-video_id="978584">' +
    '<a data-testid="video-link" href="/en/videos/978584">' +
    '<img alt="Poster Only Clip" src="https://images.sxccdn.com/videos/978584/288/poster.webp"/>' +
    '<div><time>8:12</time></div>' +
    '<video src="https://videos2.sex.com/978584/preview_240p.mp4" data-title="Poster Only Clip"></video>' +
    '</a></div></body></html>';
  const posts = sx.parseSexComListing(html, SOURCE);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].previewUrl, 'https://images.sxccdn.com/videos/978584/288/poster.webp');
});
