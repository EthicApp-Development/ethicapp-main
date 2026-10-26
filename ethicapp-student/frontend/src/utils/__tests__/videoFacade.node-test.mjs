import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeVideo,
  formatVideoDuration,
  indexCaseVideos,
  safeLinkHref,
  VIDEO_PLAYER_ALLOW,
  videoPlayerUrl
} from '../videoFacade.js';

const ID = 'M7lc1UVf-VE';
const metadata = (overrides = {}) => ({
  title: 'Introducción al caso',
  description: '',
  channelTitle: 'Canal',
  durationSeconds: 205,
  availability: 'available',
  ...overrides
});

test('formats durations as m:ss or h:mm:ss, and unknown ones as empty', () => {
  assert.equal(formatVideoDuration(5), '0:05');
  assert.equal(formatVideoDuration(205), '3:25');
  assert.equal(formatVideoDuration(3600), '1:00:00');
  assert.equal(formatVideoDuration(3725), '1:02:05');
  assert.equal(formatVideoDuration(36125), '10:02:05');
  for (const unknown of [0, -1, 1.5, null, undefined, '205', Number.NaN]) {
    assert.equal(formatVideoDuration(unknown), '', String(unknown));
  }
});

test('accepts only http and https link hrefs with a host', () => {
  assert.equal(safeLinkHref('https://example.org/a'), 'https://example.org/a');
  assert.equal(safeLinkHref('HTTP://example.org'), 'HTTP://example.org');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@example.org', '//example.org',
    '/caso', 'https://', 'http:example.org', ' https://example.org', '', null, undefined, 42]) {
    assert.equal(safeLinkHref(href), null, String(href));
  }
});

test('indexes the case videos by id, keeping null metadata and dropping invalid ids', () => {
  const byId = indexCaseVideos([
    { youtubeVideoId: ID, position: 0, url: `https://www.youtube.com/watch?v=${ID}`, metadata: metadata() },
    { youtubeVideoId: 'aaaaaaaaaaa', position: 1, metadata: null },
    { youtubeVideoId: 'bad', position: 2, metadata: metadata() },
    null
  ]);
  assert.deepEqual([...byId.keys()], [ID, 'aaaaaaaaaaa']);
  assert.equal(byId.get(ID).durationSeconds, 205);
  assert.equal(byId.get('aaaaaaaaaaa'), null);
  assert.equal(indexCaseVideos(undefined).size, 0);
  assert.equal(indexCaseVideos({ videos: [] }).size, 0);
});

test('describes a playable video with its duration when the case knows it', () => {
  assert.deepEqual(describeVideo({ videoId: ID, title: 'El caso', metadata: metadata() }), {
    title: 'El caso',
    duration: '3:25',
    playable: true,
    watchUrl: `https://www.youtube.com/watch?v=${ID}`
  });
});

test('keeps the video playable without duration when metadata is unknown', () => {
  for (const unknown of [null, undefined]) {
    const video = describeVideo({ videoId: ID, title: 'El caso', metadata: unknown });
    assert.equal(video.playable, true);
    assert.equal(video.duration, '');
  }
  assert.equal(describeVideo({ videoId: ID, title: 'El caso', metadata: metadata({ durationSeconds: null }) }).duration, '');
});

test('marks every availability other than available as not playable', () => {
  for (const availability of ['private', 'not_embeddable', 'removed']) {
    const video = describeVideo({ videoId: ID, title: 'El caso', metadata: { availability, title: null, durationSeconds: null } });
    assert.equal(video.playable, false, availability);
    assert.equal(video.watchUrl, `https://www.youtube.com/watch?v=${ID}`);
  }
});

test('prefers the video title when the block title is only its URL', () => {
  const url = `https://youtu.be/${ID}`;
  assert.equal(describeVideo({ videoId: ID, title: url, metadata: metadata() }).title, 'Introducción al caso');
  assert.equal(describeVideo({ videoId: ID, title: url, metadata: null }).title, url);
  assert.equal(describeVideo({ videoId: ID, title: '  ', metadata: metadata() }).title, 'Introducción al caso');
});

test('builds the player URL and permissions only from the id', () => {
  assert.equal(videoPlayerUrl(ID), `https://www.youtube-nocookie.com/embed/${ID}?playsinline=1&rel=0&autoplay=1`);
  assert.throws(() => videoPlayerUrl('x"><script>'), TypeError);
  assert.equal(VIDEO_PLAYER_ALLOW, 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen');
});
