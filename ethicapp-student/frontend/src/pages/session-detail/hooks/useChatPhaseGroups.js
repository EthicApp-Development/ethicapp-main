import { useEffect, useRef } from 'react';
import { legacyUserApi } from '../../../api/studentApi.js';
import { errorLogDetails } from '../../../utils/logDetails.js';
import {
  chatPhaseIdsToResolve,
  phaseGroupFromUserGroup,
  withPhaseGroupContext,
  withPhaseGroupId
} from '../phaseChatGroups.js';

/**
 * Resolves the student's group in each phase with chat other than the
 * current one (#1168), so the chat of an earlier phase, or of any phase once
 * the activity finished, opens read-only. No socket room is joined: those
 * phases take no new messages. Each phase is requested once per activity; a
 * failed request is retried when the activity state loads again.
 */
export function useChatPhaseGroups({
  session,
  sessionId,
  phases,
  currentPhaseId,
  setGroupIdByPhaseId,
  setGroupContextByPhaseId
}) {
  const requestedPhaseIdsRef = useRef(new Set());

  useEffect(() => {
    requestedPhaseIdsRef.current = new Set();
  }, [sessionId]);

  useEffect(() => {
    const userId = Number(session?.uid);

    if (!session?.isAuthenticated || !Number.isInteger(userId) || userId <= 0) {
      return;
    }

    const phaseIds = chatPhaseIdsToResolve(phases, currentPhaseId, requestedPhaseIdsRef.current);
    if (phaseIds.length === 0) {
      return;
    }

    // The answers of another activity's requests are dropped. A re-run of
    // this effect keeps the requests in flight, which it does not repeat.
    const requested = requestedPhaseIdsRef.current;

    phaseIds.forEach((phaseId) => {
      requested.add(phaseId);

      legacyUserApi
        .get(`/phases/${phaseId}/user_group/${userId}`)
        .then(({ data }) => {
          if (requestedPhaseIdsRef.current !== requested) {
            return;
          }

          const phaseGroup = phaseGroupFromUserGroup(data);
          setGroupIdByPhaseId((previous) => withPhaseGroupId(previous, phaseId, phaseGroup));
          setGroupContextByPhaseId((previous) => withPhaseGroupContext(previous, phaseId, phaseGroup));
        })
        .catch((error) => {
          requested.delete(phaseId);
          console.debug('[student] could not resolve the group of a chat phase', {
            sessionId: Number(sessionId),
            phaseId,
            ...errorLogDetails(error)
          });
        });
    });
  }, [currentPhaseId, phases, session, sessionId, setGroupContextByPhaseId, setGroupIdByPhaseId]);
}
