import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { normalizeConnectionUrl, parseConnectionInput } from '../ai-services.service.js';

// The one AI Additions connection URL rule (#834). ethicapp's
// isValidAiAdditionsUrl passes the canonical cases in
// canonical-schemas/ai-additions-connection/url-cases.json. The console image
// is built from management-console/ only, so it keeps a byte-identical copy
// next to this test; the guard below fails when the two differ, and is skipped
// where the repository is not available (the Docker test stage).
const LOCAL_CASES_URL = new URL('./fixtures/ai-additions-url-cases.json', import.meta.url);
const CANONICAL_CASES_URL = new URL(
  '../../../../canonical-schemas/ai-additions-connection/url-cases.json',
  import.meta.url
);

const { cases } = JSON.parse(readFileSync(LOCAL_CASES_URL, 'utf8'));

describe('AI Additions connection URL cases shared with ethicapp', () => {
  it('the local copy matches the canonical cases', {
    skip: existsSync(CANONICAL_CASES_URL) ? false : 'the repository is not available'
  }, () => {
    assert.equal(
      readFileSync(LOCAL_CASES_URL, 'utf8'),
      readFileSync(CANONICAL_CASES_URL, 'utf8'),
      'Copy canonical-schemas/ai-additions-connection/url-cases.json to '
        + 'management-console/backend/services/__tests__/fixtures/ai-additions-url-cases.json'
    );
  });

  it('covers both outcomes', () => {
    assert.ok(cases.some(({ valid }) => valid));
    assert.ok(cases.some(({ valid }) => !valid));
  });

  for (const { name, url, valid, normalized, reason } of cases) {
    it(`${valid ? 'accepts' : 'rejects'} ${name}`, () => {
      assert.equal(
        normalizeConnectionUrl(url),
        valid ? normalized : null,
        `${JSON.stringify(url).slice(0, 80)}: ${reason}`
      );
    });
  }

  it('saves accepted base URLs in their stored form and refuses the others', () => {
    for (const { url, valid, normalized } of cases) {
      if (valid) {
        assert.equal(parseConnectionInput({ baseUrl: url }).baseUrl, normalized);
      } else {
        assert.throws(
          () => parseConnectionInput({ baseUrl: url }),
          (error) => error.code === 'INVALID_BASE_URL'
        );
      }
    }
  });
});
