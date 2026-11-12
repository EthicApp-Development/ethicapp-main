/**
 * The words of the group chat's "is typing" notice (epic #601, #1007).
 *
 * A writer is labelled with the notice's `name` as the server sent it: the
 * participant's name, or their mask in an anonymous phase. A `null` name
 * gets the chat's own translated label: the teacher's for role "P", the
 * anonymous participant's otherwise. The client never looks a name up.
 *
 * One or two writers are named; three or more are "several people".
 */

const KEYS = Object.freeze({
  teacher: 'sessionDetail.chatTeacherAuthor',
  anonymous: 'sessionDetail.chatAnonymousAuthor',
  one: 'sessionDetail.chatComposingOne',
  two: 'sessionDetail.chatComposingTwo',
  twoBeforeI: 'sessionDetail.chatComposingTwoBeforeI',
  several: 'sessionDetail.chatComposingSeveral'
});

/**
 * @param {{ role: string, name: string|null }} writer
 * @param {(key: string, params?: object) => string} t
 * @returns {string}
 */
export function composingWriterLabel(writer, t) {
  if (typeof writer?.name === 'string' && writer.name.trim().length > 0) {
    return writer.name.trim();
  }
  return t(writer?.role === 'P' ? KEYS.teacher : KEYS.anonymous);
}

// Spanish writes "e" for "and" before a word that starts with the sound
// /i/ ("Ana e Inés", "Ana e Hilda"), but not before a diphthong ("Ana y
// Hielo"). The locales decide what each key says; English says "and" in
// both.
function startsWithISound(label) {
  const plain = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /^h?i(?![aeiou])/.test(plain);
}

/**
 * @param {Array<{ role: string, name: string|null }>} writers - In the
 *     order they started writing.
 * @param {(key: string, params?: object) => string} t
 * @returns {string} The notice, or '' when nobody is writing.
 */
export function composingNoticeText(writers, t) {
  const labels = Array.isArray(writers) ? writers.map((writer) => composingWriterLabel(writer, t)) : [];

  if (labels.length === 0) return '';
  if (labels.length === 1) return t(KEYS.one, { name: labels[0] });
  if (labels.length === 2) {
    const [first, second] = labels;
    return t(startsWithISound(second) ? KEYS.twoBeforeI : KEYS.two, { first, second });
  }
  return t(KEYS.several);
}
