import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseRichText, toPlainText } from '../richText.js';

// The shared contract (#762) and the module this app copies, read from the repository root.
const ROOT = new URL('../../../../../', import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL('canonical-schemas/rich-text/fixtures.json', ROOT), 'utf8'));

test('rich text passes every shared fixture (#764)', () => {
  assert.ok(cases.length > 0);
  for (const fixture of cases) {
    assert.deepEqual(parseRichText(fixture.input, fixture.contentType), fixture.tree, `${fixture.name}: tree`);
    assert.equal(toPlainText(fixture.input, fixture.contentType), fixture.plainText, `${fixture.name}: plain text`);
  }
});

test('richTextCore.js is a byte-identical copy of ethicapp/common/modules/rich-text.js', () => {
  const shared = readFileSync(new URL('ethicapp/common/modules/rich-text.js', ROOT), 'utf8');
  const copy = readFileSync(new URL('../richTextCore.js', import.meta.url), 'utf8');
  assert.equal(copy, shared, 'copy ethicapp/common/modules/rich-text.js over src/utils/richTextCore.js');
});
