import { describe, expect, it } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import { unsavedChangesHint } from '../unsavedChangesHint.js';

function translator(dictionary) {
  return (key, replacements = {}) => {
    const template = key.split('.').reduce((node, part) => node?.[part], dictionary) ?? key;
    return Object.entries(replacements).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      template
    );
  };
}

describe('unsavedChangesHint', () => {
  it('names the offered actions in button order, in English', () => {
    const t = translator(enUS);

    expect(unsavedChangesHint(['forget', 'confirm', 'delete'], t))
      .toBe('Save or discard your changes before confirming, deleting or forgetting this account.');
    expect(unsavedChangesHint(['delete', 'confirm'], t))
      .toBe('Save or discard your changes before confirming or deleting this account.');
    expect(unsavedChangesHint(['forget'], t))
      .toBe('Save or discard your changes before forgetting this account.');
  });

  it('names the offered actions in Spanish', () => {
    const t = translator(esCL);

    expect(unsavedChangesHint(['confirm', 'delete', 'forget'], t))
      .toBe('Guarda o descarta tus cambios antes de confirmar, eliminar u olvidar esta cuenta.');
    expect(unsavedChangesHint(['forget'], t))
      .toBe('Guarda o descarta tus cambios antes de olvidar esta cuenta.');
  });

  it('is null when no action needs the saved account', () => {
    expect(unsavedChangesHint([], translator(enUS))).toBeNull();
  });
});
