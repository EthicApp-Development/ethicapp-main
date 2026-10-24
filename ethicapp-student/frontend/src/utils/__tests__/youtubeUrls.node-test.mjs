import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { youtubeEmbedUrl, youtubeVideoId } from '../youtubeUrls.js';

const ROOT = new URL('../../../../../', import.meta.url);

test('youtubeUrls.js is a byte-identical copy of ethicapp/common/modules/youtube-urls.js', () => {
  const shared = readFileSync(new URL('ethicapp/common/modules/youtube-urls.js', ROOT), 'utf8');
  const copy = readFileSync(new URL('../youtubeUrls.js', import.meta.url), 'utf8');
  assert.equal(copy, shared, 'copy ethicapp/common/modules/youtube-urls.js over src/utils/youtubeUrls.js');
});

test('the copy parses and builds YouTube URLs (#780)', () => {
  assert.equal(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeVideoId('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeEmbedUrl('dQw4w9WgXcQ'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0');
});
