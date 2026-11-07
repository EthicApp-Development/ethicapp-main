import { useEffect, useRef, useState } from 'react';
import { legacyUserApi, studentApi } from '../../../api/studentApi.js';
import { createRealtimeConnectionMonitor } from '../../../services/realtimeConnectionMonitor.js';
import { getStudentSocket } from '../../../services/studentSocket.js';
import { joinActivityRooms } from '../activitySocketRooms.js';
import { createReconnectTracker } from '../externalResultsLoading.js';
import { errorLogDetails, socketEventLogDetails } from '../../../utils/logDetails.js';

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
  setGroupContextByPhaseId,
  onExternalServiceResult,
  onUserRoomJoined,
  onReconnect
}) {
  const [realtimeIssue, setRealtimeIssue] = useState(null);
  // Read through a ref, so a new callback never makes the socket leave and
  // rejoin its rooms.
  const onReconnectRef = useRef(onReconnect);
  const onUserRoomJoinedRef = useRef(onUserRoomJoined);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    onUserRoomJoinedRef.current = onUserRoomJoined;
  }, [onUserRoomJoined]);

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession) {
      return;
    }

    let isUnmounted = false;
    let socket = null;
    let reconnectTracker = null;
    const activeSessionId = Number(selectedSession.id);
    const connectionMonitor = createRealtimeConnectionMonitor({
      checkSession: () => studentApi.get('session'),
      onIssue: (issue) => {
        if (!isUnmounted) setRealtimeIssue(issue);
      },
      onRecovered: () => {
        if (!isUnmounted) setRealtimeIssue(null);
      }
    });
    const handleConnectError = () => {
      connectionMonitor.handleConnectError();
    };
    const handleConnect = () => {
      connectionMonitor.handleConnect();

      // A connect after the first: whatever was published while the socket
      // was down was not replayed (#1128).
      if (reconnectTracker?.handleConnect()) {
        onReconnectRef.current?.();
      }
    };

    // Socket payloads can quote students: only their ids are logged (#1139).
    const handlePhaseTransition = () => {
      console.debug('[student socket] onPhaseTransition', socketEventLogDetails(activeSessionId));

      dispatch({ type: 'ACTIVITY_FORCE_IN_PROGRESS' });
      loadCurrentPhaseState({ sessionId: activeSessionId }).catch(() => {});
      loadFullState({ sessionId: activeSessionId, userId: session.uid, invalidate: true }).catch(() => {});
    };

    const handleShareResponse = () => {
      console.debug('[student socket] onShareResponse', socketEventLogDetails(activeSessionId));
    };

    const handleEndSession = () => {
      console.debug('[student socket] onEndSession', socketEventLogDetails(activeSessionId));
      dispatch({ type: 'ACTIVITY_FORCE_FINISHED' });
    };

    const handleChatMessage = () => {
      console.debug(`[student socket] onChatMessage received for session ${activeSessionId} and phase ${currentPhaseIdRef.current}`);
      const phaseId = Number(currentPhaseIdRef.current);
      if (!Number.isInteger(phaseId) || phaseId <= 0) return;

      setChatRefreshTokenByPhaseId((prev) => ({ ...prev, [phaseId]: (prev[phaseId] ?? 0) + 1 }));
    };

    const handleExternalServiceResult = (payload) => {
      console.debug('[student socket] onExternalServiceResult', socketEventLogDetails(activeSessionId, payload));

      const payloadSessionId = Number(payload?.sessionId);
      if (Number.isInteger(payloadSessionId) && payloadSessionId > 0 && payloadSessionId !== activeSessionId) {
        return;
      }

      onExternalServiceResult?.(payload);
    };

    getStudentSocket()
      .then((instance) => {
        if (isUnmounted) return;

        socket = instance;
        reconnectTracker = createReconnectTracker({ connected: socket.connected });
        socket.on('connect_error', handleConnectError);
        socket.on('connect', handleConnect);
        // Once the student's room is joined, the results published before
        // it could receive their events are loaded (#1143).
        joinActivityRooms(socket, {
          sessionId: activeSessionId,
          userId: session.uid,
          onUserRoomJoined: () => onUserRoomJoinedRef.current?.(),
          isActive: () => !isUnmounted
        });
        socket.on('onPhaseTransition', handlePhaseTransition);
        socket.on('onShareResponse', handleShareResponse);
        socket.on('onEndSession', handleEndSession);
        socket.on('onChatMessage', handleChatMessage);
        socket.on('onExternalServiceResult', handleExternalServiceResult);
      })
      .catch((error) => {
        console.debug('[student socket] could not initialize websocket client', {
          sessionId: activeSessionId,
          ...errorLogDetails(error)
        });
        // Loading the client script from /socket.io/ fails the same way as a refused handshake.
        handleConnectError();
      });

    return () => {
      isUnmounted = true;
      setRealtimeIssue(null);
      if (!socket) return;

      socket.off('connect_error', handleConnectError);
      socket.off('connect', handleConnect);

      if (Number.isInteger(Number(currentGroupIdRef.current)) && Number(currentGroupIdRef.current) > 0) {
        socket.emit('leaveGroup', Number(currentGroupIdRef.current));
      }
      socket.emit('leaveSession', activeSessionId);
      socket.emit('leaveUser', session.uid);
      socket.off('onPhaseTransition', handlePhaseTransition);
      socket.off('onShareResponse', handleShareResponse);
      socket.off('onEndSession', handleEndSession);
      socket.off('onChatMessage', handleChatMessage);
      socket.off('onExternalServiceResult', handleExternalServiceResult);
    };
  }, [
    currentGroupIdRef,
    currentPhaseIdRef,
    dispatch,
    loadCurrentPhaseState,
    loadFullState,
    onExternalServiceResult,
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
            ...errorLogDetails(error)
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

  return { realtimeIssue };
}
