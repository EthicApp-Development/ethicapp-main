import assert from 'node:assert/strict';
import test from 'node:test';
import { caseMaterialVideos, isLongVideoDescription } from '../caseMaterial.js';

const ID_A = 'dQw4w9WgXcQ';
const ID_B = '9bZkp7q19f0';
const ID_C = 'kJQP7kiw5Fk';

const metadata = (overrides = {}) => ({
  title: 'Dilema',
  description: 'Primera línea\nSegunda línea',
  channelTitle: 'Canal',
  durationSeconds: 205,
  availability: 'available',
  ...overrides
});

const caseVideo = (youtubeVideoId, position, videoMetadata = metadata()) => ({
  youtubeVideoId,
  position,
  url: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
  metadata: videoMetadata
});

test('lists nothing for cases without videos', () => {
  for (const videos of [undefined, null, [], 'not a list', {}]) {
    assert.deepEqual(caseMaterialVideos(videos), [], JSON.stringify(videos));
  }
});

test("lists the videos in the case's order, keeping the API order for ties", () => {
  const videos = [caseVideo(ID_C, 2), caseVideo(ID_A, 0), caseVideo(ID_B, 1)];
  assert.deepEqual(caseMaterialVideos(videos).map((video) => video.videoId), [ID_A, ID_B, ID_C]);
  const unordered = [caseVideo(ID_B, undefined), caseVideo(ID_A, undefined)];
  assert.deepEqual(caseMaterialVideos(unordered).map((video) => video.videoId), [ID_B, ID_A]);
});

test('keeps the title and description as plain text, trimmed', () => {
  const [video] = caseMaterialVideos([caseVideo(ID_A, 0, metadata({
    title: '  <b>Dilema</b> ',
    description: ' <script>x</script>\nfin '
  }))]);
  assert.deepEqual(video, {
    videoId: ID_A,
    watchUrl: `https://www.youtube.com/watch?v=${ID_A}`,
    title: '<b>Dilema</b>',
    description: '<script>x</script>\nfin',
    hasLongDescription: false,
    hasMetadata: true
  });
});

test('flags videos without metadata, which show their watch link', () => {
  const [video] = caseMaterialVideos([caseVideo(ID_B, 0, null)]);
  assert.deepEqual(video, {
    videoId: ID_B,
    watchUrl: `https://www.youtube.com/watch?v=${ID_B}`,
    title: '',
    description: '',
    hasLongDescription: false,
    hasMetadata: false
  });
});

test('keeps unavailable videos, whose facade shows the notice', () => {
  const [video] = caseMaterialVideos([caseVideo(ID_A, 0, metadata({
    title: null,
    description: null,
    availability: 'removed'
  }))]);
  assert.equal(video.hasMetadata, true);
  assert.equal(video.title, '');
  assert.equal(video.description, '');
});

test("builds the watch link from the id and leaves out invalid ids", () => {
  const videos = [
    { ...caseVideo(ID_A, 0), url: 'javascript:alert(1)' },
    caseVideo('"><script>', 1),
    null,
    { position: 3 }
  ];
  assert.deepEqual(caseMaterialVideos(videos).map((video) => video.watchUrl),
    [`https://www.youtube.com/watch?v=${ID_A}`]);
});

test('collapses long descriptions only', () => {
  assert.equal(isLongVideoDescription('x'.repeat(281)), true);
  assert.equal(isLongVideoDescription('1\n2\n3\n4\n5'), true);
  assert.equal(isLongVideoDescription('1\n2\n3\n4'), false);
  assert.equal(isLongVideoDescription('breve'), false);
  assert.equal(isLongVideoDescription(null), false);
});
