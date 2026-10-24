import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalGoogleDocumentUrl, parseGoogleDocumentUrl } from '../googleDocumentUrls.js';

const ROOT = new URL('../../../../../', import.meta.url);
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xy';

test('googleDocumentUrls.js is a byte-identical copy of ethicapp/common/modules/google-document-urls.js', () => {
  const shared = readFileSync(new URL('ethicapp/common/modules/google-document-urls.js', ROOT), 'utf8');
  const copy = readFileSync(new URL('../googleDocumentUrls.js', import.meta.url), 'utf8');
  assert.equal(copy, shared, 'copy ethicapp/common/modules/google-document-urls.js over src/utils/googleDocumentUrls.js');
});

test('the copy parses and builds Google document URLs (#791)', () => {
  const parsed = parseGoogleDocumentUrl(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`);
  assert.deepEqual(parsed, { kind: 'drive_file', product: 'document', id: ID, resourceKey: null });
  assert.equal(parseGoogleDocumentUrl(`https://evil.example/document/d/${ID}/edit`), null);
  assert.equal(canonicalGoogleDocumentUrl(parsed), `https://docs.google.com/document/d/${ID}/preview`);
});
