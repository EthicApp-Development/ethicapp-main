import assert from 'node:assert/strict';
import test from 'node:test';
import * as mirror from '../composingSignalContract.js';

const ROOT = new URL('../../../../../', import.meta.url);

test('the composing signal mirror matches ethicapp/backend/helpers/composing-signal.js', async () => {
  const server = await import(new URL('ethicapp/backend/helpers/composing-signal.js', ROOT).href);

  for (const name of Object.keys(mirror)) {
    assert.equal(mirror[name], server[name], `${name} differs from the server's copy`);
  }
});
