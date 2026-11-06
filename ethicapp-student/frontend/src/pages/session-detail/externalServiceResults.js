/**
 * The external-service results a student sees in an activity (epic #1123,
 * #1128). Results come from two sources: the `onExternalServiceResult`
 * socket event, live, and the student route that rebuilds the published
 * results from the stored callbacks. Both carry the stored result's id as
 * `resultId`, so each result is kept once under a key made from it. An event
 * without `resultId` (the development mocks) keeps an id made in the browser.
 *
 * Every function here is pure: the page keeps the list in its state and
 * merges each source into it.
 */

const RESULT_KEY_PREFIX = 'result:';
const LOCAL_KEY_PREFIX = 'local:';

function normalizeResultId(resultId) {
  if (typeof resultId === 'number' && Number.isFinite(resultId)) {
    return String(resultId);
  }

  return typeof resultId === 'string' ? resultId.trim() : '';
}

/**
 * The key a result is kept under, or '' when it has none.
 * @param {{ resultId?: string|number|null, localId?: string }} result
 * @returns {string}
 */
export function externalResultKey(result) {
  const resultId = normalizeResultId(result?.resultId);

  if (resultId) {
    return `${RESULT_KEY_PREFIX}${resultId}`;
  }

  const localId = typeof result?.localId === 'string' ? result.localId.trim() : '';
  return localId ? `${LOCAL_KEY_PREFIX}${localId}` : '';
}

export function createLocalResultId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * A socket event as a result entry. An event without `resultId` gets a
 * browser-made id, so it is shown once and never merged with another one.
 * @param {object} payload
 * @param {() => string} [makeLocalId]
 * @returns {object|null}
 */
export function liveExternalResult(payload, makeLocalId = createLocalResultId) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const resultId = normalizeResultId(payload.resultId);
  const entry = resultId
    ? { ...payload, resultId }
    : { ...payload, resultId: null, localId: String(makeLocalId()) };

  return { ...entry, key: externalResultKey(entry) };
}

/**
 * The entries of the student route's answer, each with its key. An entry
 * without `resultId` cannot be merged with its event and is left out.
 * @param {unknown} results
 * @returns {object[]}
 */
export function loadedExternalResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results
    .filter((result) => result && typeof result === 'object' && normalizeResultId(result.resultId))
    .map((result) => {
      const entry = { ...result, resultId: normalizeResultId(result.resultId) };
      return { ...entry, key: externalResultKey(entry) };
    });
}

/**
 * Adds `incoming` to `previous`. A result already kept is updated in place
 * with the fields of its other source (a live entry gains `publishedAt`, a
 * loaded one `receivedAt`); a new one is appended with the next arrival
 * number. Nothing is ever removed, so a load never drops a live result that
 * arrived while it was in flight. Returns `previous` when nothing changes.
 * @param {object[]} previous
 * @param {object[]} incoming
 * @returns {object[]}
 */
export function mergeExternalResults(previous, incoming) {
  const current = Array.isArray(previous) ? previous : [];

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return current;
  }

  const indexByKey = new Map(current.map((result, index) => [result.key, index]));
  let nextArrival = current.reduce((max, result) => Math.max(max, Number(result.arrival) || 0), 0);
  let next = current;

  incoming.forEach((result) => {
    const key = result?.key || externalResultKey(result);
    if (!key) {
      return;
    }

    if (next === current) {
      next = [...current];
    }

    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      next[index] = { ...next[index], ...result, key, arrival: next[index].arrival };
      return;
    }

    nextArrival += 1;
    indexByKey.set(key, next.length);
    next.push({ ...result, key, arrival: nextArrival });
  });

  return next;
}

/**
 * The entries of `incoming` whose key is not in `knownKeys`, once each.
 * @param {Set<string>} knownKeys
 * @param {object[]} incoming
 * @returns {object[]}
 */
export function unseenExternalResults(knownKeys, incoming) {
  const seen = new Set(knownKeys);
  const unseen = [];

  (Array.isArray(incoming) ? incoming : []).forEach((result) => {
    const key = result?.key || externalResultKey(result);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    unseen.push(result);
  });

  return unseen;
}

function resultTime(result) {
  const time = Date.parse(result?.publishedAt || result?.receivedAt || '');
  return Number.isNaN(time) ? null : time;
}

/**
 * Newest first: by publication time (`publishedAt`, or `receivedAt` for a
 * live event), then by arrival in the page. A result without a time goes
 * last.
 */
export function compareExternalResultsNewestFirst(left, right) {
  const leftTime = resultTime(left);
  const rightTime = resultTime(right);

  if (leftTime !== rightTime) {
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  }

  return (Number(right?.arrival) || 0) - (Number(left?.arrival) || 0);
}

/**
 * The results of each phase, newest first. Results without a positive
 * integer `phaseId` belong to no phase tab and are left out.
 * @param {object[]} results
 * @returns {Record<number, object[]>}
 */
export function groupExternalResultsByPhase(results) {
  const byPhaseId = {};

  (Array.isArray(results) ? results : []).forEach((result) => {
    const phaseId = Number(result?.phaseId);
    if (!Number.isInteger(phaseId) || phaseId <= 0) {
      return;
    }

    (byPhaseId[phaseId] ??= []).push(result);
  });

  Object.values(byPhaseId).forEach((phaseResults) => {
    phaseResults.sort(compareExternalResultsNewestFirst);
  });

  return byPhaseId;
}
