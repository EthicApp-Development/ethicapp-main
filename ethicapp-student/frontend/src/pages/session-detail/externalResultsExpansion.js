/**
 * Which external-service results are expanded (epic #1123, #1128). The
 * newest result of the current phase is expanded and every other result is
 * collapsed until the student toggles it. A toggle is kept by result key in
 * page state only: it is never stored, and a reload starts from the
 * defaults again.
 */

/**
 * The key of the result expanded by default: the newest result of the
 * current phase, or null when that phase has none or there is no current
 * phase (a finished activity).
 * @param {Record<number, object[]>} resultsByPhaseId - Newest first.
 * @param {number|string|null} currentPhaseId
 * @returns {string|null}
 */
export function defaultExpandedResultKey(resultsByPhaseId, currentPhaseId) {
  const phaseId = Number(currentPhaseId);

  if (!Number.isInteger(phaseId) || phaseId <= 0) {
    return null;
  }

  const newest = resultsByPhaseId?.[phaseId]?.[0];
  return newest?.key || null;
}

/**
 * @param {Record<string, boolean>} toggledByKey - The student's toggles.
 * @param {string} key
 * @param {string|null} defaultExpandedKey
 * @returns {boolean}
 */
export function isExternalResultExpanded(toggledByKey, key, defaultExpandedKey) {
  if (typeof toggledByKey?.[key] === 'boolean') {
    return toggledByKey[key];
  }

  return Boolean(key) && key === defaultExpandedKey;
}

/**
 * The toggles after the student expands or collapses `key`.
 * @param {Record<string, boolean>} toggledByKey
 * @param {string} key
 * @param {string|null} defaultExpandedKey
 * @returns {Record<string, boolean>}
 */
export function toggleExternalResult(toggledByKey, key, defaultExpandedKey) {
  if (!key) {
    return toggledByKey;
  }

  return {
    ...(toggledByKey ?? {}),
    [key]: !isExternalResultExpanded(toggledByKey, key, defaultExpandedKey)
  };
}
