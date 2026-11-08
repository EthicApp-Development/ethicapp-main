/**
 * The student's group in each phase with chat (#1168). The page resolves the
 * current phase's group as it joins that group's socket room
 * (useActivityRealtimeSync); the other phases with chat, earlier phases and
 * every phase of a finished activity, which has no current phase, get their
 * group from the same route with no socket, so their chat opens read-only.
 *
 * Every function here is pure.
 */

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The ids of the phases whose group the page still has to resolve: phases
 * with chat, other than the current one, neither resolved nor requested yet.
 * @param {object[]|null|undefined} phases the activity state's phases
 * @param {number|null|undefined} currentPhaseId null when the activity finished
 * @param {Set<number>} requestedPhaseIds phases already requested, with or without a group
 * @returns {number[]}
 */
export function chatPhaseIdsToResolve(phases, currentPhaseId, requestedPhaseIds) {
  if (!Array.isArray(phases)) {
    return [];
  }

  const currentId = positiveId(currentPhaseId);

  return phases
    .filter((phase) => phase?.features?.chat === true)
    .map((phase) => positiveId(phase?.id))
    .filter((phaseId) => phaseId !== null && phaseId !== currentId && !requestedPhaseIds.has(phaseId));
}

/**
 * The group of a `GET /phases/:id/user_group/:user_id` answer, or null when
 * the student had no group in that phase.
 * @param {object|null|undefined} data
 * @returns {{ groupId: number, context: { phaseAnonymous: boolean, participants: object[] } }|null}
 */
export function phaseGroupFromUserGroup(data) {
  const groupId = positiveId(data?.team_id);

  if (groupId === null) {
    return null;
  }

  return {
    groupId,
    context: {
      phaseAnonymous: Boolean(data?.phase_anonymous),
      participants: Array.isArray(data?.participants) ? data.participants : []
    }
  };
}

function sameContext(left, right) {
  return left?.phaseAnonymous === right?.phaseAnonymous
    && JSON.stringify(left?.participants ?? []) === JSON.stringify(right?.participants ?? []);
}

function withoutKey(map, key) {
  if (!(key in map)) {
    return map;
  }

  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * The page's group id map with the group of `phaseId`, or without the phase
 * when `phaseGroup` is null. An unchanged map keeps its identity, so React
 * skips the render.
 * @param {Record<number, number>} groupIdByPhaseId
 * @param {number} phaseId
 * @param {ReturnType<typeof phaseGroupFromUserGroup>} phaseGroup
 */
export function withPhaseGroupId(groupIdByPhaseId, phaseId, phaseGroup) {
  if (!phaseGroup) {
    return withoutKey(groupIdByPhaseId, phaseId);
  }

  return groupIdByPhaseId[phaseId] === phaseGroup.groupId
    ? groupIdByPhaseId
    : { ...groupIdByPhaseId, [phaseId]: phaseGroup.groupId };
}

/**
 * The page's group context map with the context of `phaseId`, or without the
 * phase when `phaseGroup` is null. An unchanged map keeps its identity.
 * @param {Record<number, object>} groupContextByPhaseId
 * @param {number} phaseId
 * @param {ReturnType<typeof phaseGroupFromUserGroup>} phaseGroup
 */
export function withPhaseGroupContext(groupContextByPhaseId, phaseId, phaseGroup) {
  if (!phaseGroup) {
    return withoutKey(groupContextByPhaseId, phaseId);
  }

  return sameContext(groupContextByPhaseId[phaseId], phaseGroup.context)
    ? groupContextByPhaseId
    : { ...groupContextByPhaseId, [phaseId]: phaseGroup.context };
}
