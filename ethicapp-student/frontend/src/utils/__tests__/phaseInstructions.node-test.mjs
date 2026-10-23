import assert from 'node:assert/strict';
import test from 'node:test';
import { phaseInstructions } from '../phaseInstructions.js';

test('design instructions come with their content type (#766)', () => {
  assert.deepEqual(phaseInstructions({ instructions: '**Lee**', instructionsContentType: 'text/markdown' }),
    { text: '**Lee**', contentType: 'text/markdown' });
  assert.deepEqual(phaseInstructions({ instructions: 'Lee' }), { text: 'Lee', contentType: 'text/plain' },
    'cached states from before #763 have no content type');
});

test('the legacy question fallback is always text/plain', () => {
  assert.deepEqual(phaseInstructions({ instructions: '  ', instructionsContentType: 'text/markdown', question: '¿Quién?' }),
    { text: '¿Quién?', contentType: 'text/plain' });
  assert.deepEqual(phaseInstructions(undefined), { text: '', contentType: 'text/plain' });
});
