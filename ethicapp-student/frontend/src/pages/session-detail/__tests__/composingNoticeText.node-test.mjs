import assert from 'node:assert/strict';
import test from 'node:test';
import { composingNoticeText, composingWriterLabel } from '../composingNoticeText.js';
import { createTranslator } from '../../../i18n/translator.js';

const es = createTranslator('es_CL');
const en = createTranslator('en_US');

const ana = { role: 'A', name: 'Ana' };
const luis = { role: 'A', name: 'Luis' };
const teacher = { role: 'P', name: null };
const anonymous = { role: 'A', name: null };
const masked = { role: 'A', name: 'Zorro' };

test('nobody writing is no notice', () => {
  assert.equal(composingNoticeText([], es), '');
  assert.equal(composingNoticeText(undefined, en), '');
});

test('one writer is named', () => {
  assert.equal(composingNoticeText([ana], es), 'Ana está escribiendo…');
  assert.equal(composingNoticeText([ana], en), 'Ana is typing…');
});

test('two writers are named in the order they started', () => {
  assert.equal(composingNoticeText([ana, luis], es), 'Ana y Luis están escribiendo…');
  assert.equal(composingNoticeText([luis, ana], en), 'Luis and Ana are typing…');
});

test('three or more writers are several people', () => {
  assert.equal(composingNoticeText([ana, luis, teacher], es), 'Varias personas están escribiendo…');
  assert.equal(composingNoticeText([ana, luis, masked, anonymous], en), 'Several people are typing…');
});

test('the teacher, who comes without a name, gets the chat\'s teacher label', () => {
  assert.equal(composingNoticeText([teacher], es), 'Docente está escribiendo…');
  assert.equal(composingNoticeText([teacher], en), 'Teacher is typing…');
  assert.equal(composingNoticeText([ana, teacher], es), 'Ana y Docente están escribiendo…');
});

test('an anonymous phase shows the chat\'s labels: the mask, or the anonymous label', () => {
  assert.equal(composingNoticeText([masked], es), 'Zorro está escribiendo…');
  assert.equal(composingNoticeText([anonymous], es), 'Integrante anónimo está escribiendo…');
  assert.equal(composingNoticeText([anonymous], en), 'Anonymous teammate is typing…');
  assert.equal(composingWriterLabel(anonymous, es), es('sessionDetail.chatAnonymousAuthor'));
  assert.equal(composingWriterLabel(teacher, en), en('sessionDetail.chatTeacherAuthor'));
});

test('the name is used as sent, whatever the role', () => {
  assert.equal(composingWriterLabel({ role: 'P', name: ' Profesora Rojas ' }, es), 'Profesora Rojas');
  assert.equal(composingWriterLabel({ role: 'A', name: '' }, es), 'Integrante anónimo');
});

test('Spanish says "e" before a name that starts with the sound /i/, and English "and"', () => {
  for (const second of ['Inés', 'Ignacio', 'Íñigo', 'Hilda']) {
    const writers = [ana, { role: 'A', name: second }];
    assert.equal(composingNoticeText(writers, es), `Ana e ${second} están escribiendo…`);
    assert.equal(composingNoticeText(writers, en), `Ana and ${second} are typing…`);
  }
  assert.equal(composingNoticeText([ana, anonymous], es), 'Ana e Integrante anónimo están escribiendo…');
  for (const second of ['Hielo', 'Yolanda', 'Luis']) {
    assert.equal(composingNoticeText([ana, { role: 'A', name: second }], es), `Ana y ${second} están escribiendo…`);
  }
});

test('every key of the notice exists in both locales', () => {
  for (const key of ['chatComposingOne', 'chatComposingTwo', 'chatComposingTwoBeforeI', 'chatComposingSeveral']) {
    for (const t of [es, en]) {
      assert.notEqual(t(`sessionDetail.${key}`), `sessionDetail.${key}`);
    }
  }
});
