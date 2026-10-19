// Maps responses of POST /student/api/sessions/join to UI outcomes.

export const JOIN_RESULT_KINDS = Object.freeze({
  JOINED: 'joined',
  ALREADY_JOINED: 'already_joined',
  CODE_NOT_FOUND: 'code_not_found',
  JOINING_CLOSED: 'joining_closed',
  INVALID_REQUEST: 'invalid_request',
  FAILED: 'failed'
});

const MESSAGE_KEYS = {
  [JOIN_RESULT_KINDS.JOINED]: 'joinSession.joinedSuccess',
  [JOIN_RESULT_KINDS.ALREADY_JOINED]: 'joinSession.alreadyJoined',
  [JOIN_RESULT_KINDS.CODE_NOT_FOUND]: 'joinSession.codeNotFound',
  [JOIN_RESULT_KINDS.JOINING_CLOSED]: 'joinSession.joiningClosed',
  [JOIN_RESULT_KINDS.INVALID_REQUEST]: 'joinSession.invalidCode',
  [JOIN_RESULT_KINDS.FAILED]: 'joinSession.joinErrorFallback'
};

function toResult(kind, sessionId = null) {
  return {
    kind,
    sessionId,
    messageKey: MESSAGE_KEYS[kind],
    succeeded: kind === JOIN_RESULT_KINDS.JOINED || kind === JOIN_RESULT_KINDS.ALREADY_JOINED
  };
}

/**
 * @param {{ data?: { status?: string, sesid?: unknown } }} response Successful HTTP response.
 */
export function interpretJoinResponse(response) {
  const status = response?.data?.status;
  const sessionId = Number(response?.data?.sesid);

  if (
    (status === JOIN_RESULT_KINDS.JOINED || status === JOIN_RESULT_KINDS.ALREADY_JOINED) &&
    Number.isInteger(sessionId) &&
    sessionId > 0
  ) {
    return toResult(status, sessionId);
  }

  return toResult(JOIN_RESULT_KINDS.FAILED);
}

/**
 * @param {{ response?: { status?: number, data?: { status?: string } } }} error Rejected HTTP call.
 */
export function interpretJoinError(error) {
  const status = error?.response?.data?.status;

  if (
    status === JOIN_RESULT_KINDS.CODE_NOT_FOUND ||
    status === JOIN_RESULT_KINDS.JOINING_CLOSED ||
    status === JOIN_RESULT_KINDS.INVALID_REQUEST
  ) {
    return toResult(status);
  }

  return toResult(JOIN_RESULT_KINDS.FAILED);
}
