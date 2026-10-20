import { API_ERROR_KINDS, classifyApiError } from '../api/apiErrors.js';

/**
 * Turns Socket.IO connection failures into a realtime status for one view.
 *
 * A handshake refused at the edge reaches the client as a generic transport
 * error without its HTTP status, so the first failure of each disconnection
 * checks the session over HTTP instead. That request goes through the API
 * interceptors: an expired session starts the expiry flow there, and any
 * other outcome is reported as a realtime issue until the socket connects.
 * @param {object} options
 * @param {() => Promise<unknown>} options.checkSession
 * @param {(issue: { kind: string, requestId: string|null }) => void} options.onIssue
 * @param {() => void} options.onRecovered
 */
export function createRealtimeConnectionMonitor({ checkSession, onIssue, onRecovered }) {
  let connectionCount = 0;
  let checking = false;
  let reported = false;

  return {
    async handleConnectError() {
      if (checking || reported) {
        return;
      }

      checking = true;
      const startedAt = connectionCount;
      let issue;

      try {
        await checkSession();
        issue = { kind: API_ERROR_KINDS.UNAVAILABLE, requestId: null };
      } catch (error) {
        const { kind, requestId } = classifyApiError(error);
        issue = { kind, requestId };
      } finally {
        checking = false;
      }

      // Reconnected while checking, or the session expired: nothing to show.
      if (connectionCount !== startedAt || issue.kind === API_ERROR_KINDS.EXPIRED) {
        return;
      }

      reported = true;
      onIssue(issue);
    },
    handleConnect() {
      connectionCount += 1;

      if (reported) {
        reported = false;
        onRecovered();
      }
    }
  };
}
