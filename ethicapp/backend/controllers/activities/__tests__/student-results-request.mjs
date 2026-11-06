// Sends GET /activities/:id/users/:user_id/external_service_results (or, with
// `endpoint`, another route of that form, such as full_state) to a router in
// an app with a fixed session, for the route's guardrail and integration
// tests. This file is a test helper, not a test: its name ends in
// neither .node-test.mjs nor .integration-test.mjs.
import express from "express";

/**
 * @param {import("express").Router} router
 * @param {Object} options
 * @param {Object|null} options.session - `req.session`; null for none.
 * @param {number|string} options.sessionId
 * @param {number|string} [options.userId] - Defaults to the session's uid.
 * @param {string} [options.endpoint] - The last path segment.
 * @returns {Promise<{ status: number, body: unknown, cacheControl: string|null }>}
 */
export async function requestStudentResults(router, {
    session,
    sessionId,
    userId = session?.uid,
    endpoint = "external_service_results",
}) {
    const app = express();
    app.use((req, res, next) => {
        req.session = session ?? undefined;
        next();
    });
    app.use(router);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    try {
        const response = await fetch(
            `http://127.0.0.1:${port}/activities/${sessionId}/users/${userId}/${endpoint}`
        );
        return {
            status:       response.status,
            body:         await response.json(),
            cacheControl: response.headers.get("cache-control"),
        };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}
