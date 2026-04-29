import { useEffect } from 'react';
import { legacyUserApi } from '../../../api/studentApi.js';
import { getStudentSocket } from '../../../services/studentSocket.js';

export function useActivityRealtimeSync({
  session,
  selectedSession,
  currentPhaseIdRef,
  currentGroupIdRef,
  loadCurrentPhaseState,
  loadFullState,
  dispatch,
  setChatRefreshTokenByPhaseId,
  activityCurrentPhaseId,
  setGroupIdByPhaseId,
  setGroupContextByPhaseId
}) {
  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession) {
      return;
    }

    let isUnmounted = false;
    let socket = null;
    const activeSessionId = Number(selectedSession.id);

    const handlePhaseTransition = (...payload) => {
      console.debug('[student socket] onPhaseTransition', { sessionId: activeSessionId, payload });

      dispatch({ type: 'ACTIVITY_FORCE_IN_PROGRESS' });
      loadCurrentPhaseState({ sessionId: activeSessionId }).catch(() => {});
      loadFullState({ sessionId: activeSessionId, userId: session.uid, invalidate: true }).catch(() => {});
    };

    const handleShareResponse = (payload) => {
      console.debug('[student socket] onShareResponse', { sessionId: activeSessionId, payload });
    };

    const handleEndSession = (payload) => {
      console.debug('[student socket] onEndSession', { sessionId: activeSessionId, payload });
      dispatch({ type: 'ACTIVITY_FORCE_FINISHED' });
    };

    const handleChatMessage = () => {
      const phaseId = Number(currentPhaseIdRef.current);
      if (!Number.isInteger(phaseId) || phaseId <= 0) return;

      setChatRefreshTokenByPhaseId((prev) => ({ ...prev, [phaseId]: (prev[phaseId] ?? 0) + 1 }));
    };

    getStudentSocket()
      .then((instance) => {
        if (isUnmounted) return;

        socket = instance;
        socket.emit('joinSession', activeSessionId);
        socket.on('onPhaseTransition', handlePhaseTransition);
        socket.on('onShareResponse', handleShareResponse);
        socket.on('onEndSession', handleEndSession);
        socket.on('onChatMessage', handleChatMessage);
      })
      .catch((error) => {
        console.debug('[student socket] could not initialize websocket client', { sessionId: activeSessionId, error });
      });

    return () => {
      isUnmounted = true;
      if (!socket) return;

      if (Number.isInteger(Number(currentGroupIdRef.current)) && Number(currentGroupIdRef.current) > 0) {
        socket.emit('leaveGroup', Number(currentGroupIdRef.current));
      }
      socket.emit('leaveSession', activeSessionId);
      socket.off('onPhaseTransition', handlePhaseTransition);
      socket.off('onShareResponse', handleShareResponse);
      socket.off('onEndSession', handleEndSession);
      socket.off('onChatMessage', handleChatMessage);
    };
  }, [
    currentGroupIdRef,
    currentPhaseIdRef,
    dispatch,
    loadCurrentPhaseState,
    loadFullState,
    selectedSession,
    session,
    setChatRefreshTokenByPhaseId
  ]);

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession || !session.uid || !activityCurrentPhaseId) {
      return;
    }

    let isUnmounted = false;
    const phaseId = Number(activityCurrentPhaseId);
    if (!Number.isInteger(phaseId) || phaseId <= 0) return;

    getStudentSocket()
      .then(async (socket) => {
        if (isUnmounted) return;

        try {
          const { data } = await legacyUserApi.get(`/phases/${phaseId}/user_group/${session.uid}`);
          if (isUnmounted) return;

          const nextGroupId = Number(data?.team_id);
          const previousGroupId = Number(currentGroupIdRef.current);

          if (Number.isInteger(nextGroupId) && nextGroupId > 0) {
            setGroupIdByPhaseId((prev) => (prev[phaseId] === nextGroupId ? prev : { ...prev, [phaseId]: nextGroupId }));
            setGroupContextByPhaseId((prev) => {
              const nextContext = {
                phaseAnonymous: Boolean(data?.phase_anonymous),
                participants: Array.isArray(data?.participants) ? data.participants : []
              };

              const previousContext = prev[phaseId];
              if (
                previousContext?.phaseAnonymous === nextContext.phaseAnonymous
                && JSON.stringify(previousContext?.participants ?? []) === JSON.stringify(nextContext.participants)
              ) {
                return prev;
              }

              return { ...prev, [phaseId]: nextContext };
            });
          } else {
            setGroupIdByPhaseId((prev) => {
              if (!(phaseId in prev)) return prev;
              const next = { ...prev };
              delete next[phaseId];
              return next;
            });
            setGroupContextByPhaseId((prev) => {
              if (!(phaseId in prev)) return prev;
              const next = { ...prev };
              delete next[phaseId];
              return next;
            });
          }

          if (Number.isInteger(previousGroupId) && previousGroupId > 0 && previousGroupId !== nextGroupId) {
            socket.emit('leaveGroup', previousGroupId);
          }

          if (Number.isInteger(nextGroupId) && nextGroupId > 0 && previousGroupId !== nextGroupId) {
            socket.emit('joinGroup', nextGroupId);
            currentGroupIdRef.current = nextGroupId;
            return;
          }

          if (!Number.isInteger(nextGroupId) || nextGroupId <= 0) {
            currentGroupIdRef.current = null;
          }
        } catch (error) {
          console.debug('[student socket] failed to resolve group for current phase', {
            sessionId: Number(selectedSession.id),
            phaseId,
            error
          });
        }
      })
      .catch(() => {});

    return () => {
      isUnmounted = true;
    };
  }, [
    activityCurrentPhaseId,
    currentGroupIdRef,
    selectedSession,
    session,
    setGroupContextByPhaseId,
    setGroupIdByPhaseId
  ]);
}
