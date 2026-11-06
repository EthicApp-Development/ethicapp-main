/**
 * Reads the results external services published to a student in an activity
 * (epic #1123, #1127): `GET /activities/:id/users/:user_id/external_service_results`
 * on the legacy EthicApp API, next to `full_state`. The answer is
 * `{ results: [{ serviceId, resultId, phaseId, questionId, component,
 * payload, message, status, publishedAt }] }`, oldest first, never cached.
 *
 * The client is passed in (the page passes `legacyUserApi`), so the request
 * goes through the same error interceptors as `full_state`.
 *
 * @param {{ get: Function }} client - An axios instance.
 * @param {{ sessionId: number, userId: number }} options
 * @returns {Promise<object[]>} The answer's results, or [] when it has none.
 */
export async function fetchStudentExternalResults(client, { sessionId, userId } = {}) {
  const parsedSessionId = Number(sessionId);
  const parsedUserId = Number(userId);

  if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
    throw new TypeError('A positive integer session id is required.');
  }

  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    throw new TypeError('A positive integer user id is required.');
  }

  const { data } = await client.get(
    `/activities/${parsedSessionId}/users/${parsedUserId}/external_service_results`
  );

  return Array.isArray(data?.results) ? data.results : [];
}
