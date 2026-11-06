/**
 * State of the help disclosures of a student result (#1132): the overview
 * and each criterion's description. Each opens and closes on its own, with
 * its button (click, tap, Enter or Space) or with Escape. The state is a set
 * of the open disclosures' keys, replaced on every change so React sees it.
 */

/**
 * `openKeys` with `key` opened when it was closed, or closed when it was open.
 * @param {Set<string>} openKeys
 * @param {string} key
 * @returns {Set<string>}
 */
export function toggleDisclosure(openKeys, key) {
  const next = new Set(openKeys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * `openKeys` with `key` closed; the same set when it was already closed.
 * @param {Set<string>} openKeys
 * @param {string} key
 * @returns {Set<string>}
 */
export function closeDisclosure(openKeys, key) {
  if (!openKeys.has(key)) {
    return openKeys;
  }
  const next = new Set(openKeys);
  next.delete(key);
  return next;
}

/**
 * What a key pressed on an open or closed disclosure does: 'close' for
 * Escape on an open one, null otherwise. Enter and Space reach the button as
 * a click, so they need no handling here.
 * @param {string} key - `KeyboardEvent.key`.
 * @param {boolean} expanded
 * @returns {'close'|null}
 */
export function disclosureKeyAction(key, expanded) {
  return expanded && (key === 'Escape' || key === 'Esc') ? 'close' : null;
}
