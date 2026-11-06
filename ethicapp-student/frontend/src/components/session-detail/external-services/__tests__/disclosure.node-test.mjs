import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeDisclosure,
  disclosureKeyAction,
  toggleDisclosure
} from '../student-result/disclosure.js';

test('toggleDisclosure opens and closes one disclosure, leaving the others', () => {
  const none = new Set();
  const one = toggleDisclosure(none, 'section-0-criterion-1');
  assert.deepEqual([...one], ['section-0-criterion-1']);
  assert.deepEqual([...none], [], 'the previous set is not changed');

  const two = toggleDisclosure(one, 'overview');
  assert.deepEqual([...two].sort(), ['overview', 'section-0-criterion-1']);
  assert.deepEqual([...toggleDisclosure(two, 'section-0-criterion-1')], ['overview']);
});

test('closeDisclosure closes an open disclosure and keeps the set otherwise', () => {
  const open = new Set(['overview', 'section-0-criterion-0']);
  assert.deepEqual([...closeDisclosure(open, 'overview')], ['section-0-criterion-0']);
  assert.equal(closeDisclosure(open, 'section-1-criterion-0'), open);
});

test('Escape closes an open disclosure; other keys do nothing', () => {
  assert.equal(disclosureKeyAction('Escape', true), 'close');
  assert.equal(disclosureKeyAction('Esc', true), 'close');
  assert.equal(disclosureKeyAction('Escape', false), null);
  assert.equal(disclosureKeyAction('Enter', true), null);
  assert.equal(disclosureKeyAction(' ', false), null);
  assert.equal(disclosureKeyAction('Tab', true), null);
});
