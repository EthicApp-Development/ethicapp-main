import { useCallback, useEffect, useRef, useState } from 'react';
import { legacyUserApi, studentApi } from '../../../api/studentApi.js';
import { createRealtimeConnectionMonitor } from '../../../services/realtimeConnectionMonitor.js';
import { getStudentSocket } from '../../../services/studentSocket.js';
import { joinActivityRooms } from '../activitySocketRooms.js';
import {
  phaseGroupFromUserGroup,
  withPhaseGroupContext,
  withPhaseGroupId
} from '../phaseChatGroups.js';
import { createReconnectTracker } from '../externalResultsLoading.js';
import { REALTIME_STATUS, createRealtimeFallback } from '../realtimeFallback.js';
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
  onReconnect,
  refreshActivity,
  probeActivity
}) {
  const [realtimeIssue, setRealtimeIssue] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(REALTIME_STATUS.CONNECTING);
  const [socketInstance, setSocketInstance] = useState(null);
  // Read through refs, so a new callback never makes the socket leave and
  // rejoin its rooms.
  const onReconnectRef = useRef(onReconnect);
  const onUserRoomJoinedRef = useRef(onUserRoomJoined);
  const refreshActivityRef = useRef(refreshActivity);
  const probeActivityRef = useRef(probeActivity);
  const fallbackRef = useRef(null);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    onUserRoomJoinedRef.current = onUserRoomJoined;
  }, [onUserRoomJoined]);

  useEffect(() => {
    refreshActivityRef.current = refreshActivity;
    probeActivityRef.current = probeActivity;
  }, [probeActivity, refreshActivity]);

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
    // Without a working socket the view keeps itself current by polling,
    // and refreshes when the socket comes back (#626).
    const fallback = createRealtimeFallback({
      refresh: (request) => refreshActivityRef.current?.(request) ?? Promise.resolve(),
      probe: () => probeActivityRef.current?.() ?? Promise.resolve(false),
      onStatus: (status) => {
        if (!isUnmounted) setConnectionStatus(status);
      },
      onError: (error, operation) => {
        console.debug(`[student socket] activity ${operation} failed`, {
          sessionId: activeSessionId,
          ...errorLogDetails(error)
        });
      }
    });
    fallbackRef.current = fallback;
    setConnectionStatus(fallback.status());

    const handlePageVisible = () => {
      if (document.visibilityState === 'visible') fallback.pageVisible();
    };
    document.addEventListener('visibilitychange', handlePageVisible);
    window.addEventListener('focus', handlePageVisible);

    const handleConnectError = () => {
      connectionMonitor.handleConnectError();
      fallback.lost();
    };
    const handleDisconnect = () => {
      fallback.lost();
    };
    const handleConnect = () => {
      connectionMonitor.handleConnect();

      // A connect after the first: the server forgot the rooms of the old
      // connection, so they are joined again (#1108), and the results are
      // loaded once the student's room is back, since whatever was published
      // while the socket was down was not replayed (#1128, #1143).
      if (socket && reconnectTracker?.handleConnect()) {
        joinActivityRooms(socket, {
          sessionId: activeSessionId,
          userId: session.uid,
          groupId: currentGroupIdRef.current,
          onUserRoomJoined: () => onReconnectRef.current?.(),
          isActive: () => !isUnmounted
        });
      }
      // Reloads the activity after a drop, for a transition missed meanwhile.
      fallback.connected();
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
        setSocketInstance(instance);
        reconnectTracker = createReconnectTracker({ connected: socket.connected });
        if (socket.connected) fallback.connected();
        socket.on('connect_error', handleConnectError);
        socket.on('disconnect', handleDisconnect);
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
      setSocketInstance(null);
      fallback.dispose();
      if (fallbackRef.current === fallback) fallbackRef.current = null;
      document.removeEventListener('visibilitychange', handlePageVisible);
      window.removeEventListener('focus', handlePageVisible);
      if (!socket) return;

      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
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

          const phaseGroup = phaseGroupFromUserGroup(data);
          const nextGroupId = phaseGroup?.groupId ?? null;
          const previousGroupId = Number(currentGroupIdRef.current);

          setGroupIdByPhaseId((prev) => withPhaseGroupId(prev, phaseId, phaseGroup));
          setGroupContextByPhaseId((prev) => withPhaseGroupContext(prev, phaseId, phaseGroup));

          if (Number.isInteger(previousGroupId) && previousGroupId > 0 && previousGroupId !== nextGroupId) {
            socket.emit('leaveGroup', previousGroupId);
          }

          if (nextGroupId !== null && previousGroupId !== nextGroupId) {
            socket.emit('joinGroup', nextGroupId);
            currentGroupIdRef.current = nextGroupId;
            return;
          }

          if (nextGroupId === null) {
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
      .catch((error) => {
        // The socket's own failure is reported by the connection state.
        console.debug('[student socket] could not join the current phase group', {
          sessionId: Number(selectedSession.id),
          phaseId,
          ...errorLogDetails(error)
        });
      });

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

  // The view's "Update activity" action (realtimeFallback.updateNow()):
  // shared while it runs and held for a while after it.
  const updateNow = useCallback(() => {
    if (fallbackRef.current) return fallbackRef.current.updateNow();
    return Promise.resolve(refreshActivityRef.current?.({ invalidate: true }))
      .then(() => ({ ok: true, changed: true, heldUntil: Date.now() }), () => ({ ok: false, changed: true, heldUntil: Date.now() }));
  }, []);

  // The socket for what the student sends over it, such as the chat's
  // composing signals (#656): only while it is connected, never while the
  // view polls.
  const connectedSocket = connectionStatus === REALTIME_STATUS.CONNECTED ? socketInstance : null;

  return { realtimeIssue, connectionStatus, updateNow, connectedSocket };
}
