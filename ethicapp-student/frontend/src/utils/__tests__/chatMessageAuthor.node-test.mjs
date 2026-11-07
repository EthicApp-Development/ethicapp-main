import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageAuthorName } from '../chatMessageAuthor.js';

test('an external agent message shows the author_name the chat route sends (#1026)', () => {
  assert.equal(chatMessageAuthorName({ author_name: 'agente' }, 'external_service'), 'agente');
  assert.equal(chatMessageAuthorName({ author_name: '  Profe Ana ' }, 'external_service'), 'Profe Ana');
});

test('an external agent message without author_name has no name, so the overlay shows its fallback', () => {
  assert.equal(chatMessageAuthorName({ author_name: '   ' }, 'external_service'), '');
  assert.equal(chatMessageAuthorName({}, 'external_service'), '');
});

test("a participant's message ignores author_name, which holds the account name", () => {
  assert.equal(chatMessageAuthorName({ author_name: 'Real Name' }, 'A'), '');
  assert.equal(chatMessageAuthorName({ author_name: 'Real Name', display_name: 'Shown' }, 'A'), 'Shown');
  assert.equal(chatMessageAuthorName({ username: 'user-1' }, ''), 'user-1');
});
