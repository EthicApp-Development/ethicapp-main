// The hint shown while the account form has unsaved edits, which disable the
// account actions (confirm, set password, delete, forget): each of them acts on the account
// as it was saved. It names the actions the page offers, in the order of the
// buttons, for example "Save or discard your changes before confirming,
// deleting or forgetting this account."

export const UNSAVED_HINT_ACTIONS = Object.freeze(['confirm', 'setPassword', 'delete', 'forget']);

// "a", "a or b", "a, b or c", with the locale's "or". Spanish writes "u"
// instead of "o" before a word that starts with the sound o ("eliminar u
// olvidar"), so each locale also gives `orBeforeO`.
function joinAlternatives(items, t) {
  if (items.length <= 1) {
    return items.join('');
  }
  const last = items.at(-1);
  const or = /^h?o/i.test(last)
    ? t('pages.userShow.unsavedChangesHint.orBeforeO')
    : t('pages.userShow.unsavedChangesHint.or');
  return `${items.slice(0, -1).join(', ')} ${or} ${last}`;
}

// The hint for the offered actions, or null when the page offers none.
export function unsavedChangesHint(actions, t) {
  const offered = UNSAVED_HINT_ACTIONS.filter((action) => actions.includes(action));
  if (offered.length === 0) {
    return null;
  }

  const verbs = offered.map((action) => t(`pages.userShow.unsavedChangesHint.${action}`));
  return t('pages.userShow.unsavedChangesHint.template', {
    actions: joinAlternatives(verbs, t)
  });
}
