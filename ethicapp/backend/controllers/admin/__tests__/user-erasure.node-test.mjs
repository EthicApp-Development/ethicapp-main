import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";

import { createUserErasureRouter } from "../user-erasure.js";

const REQUESTED_AT = "2026-10-29T12:00:00.000Z";

function storedRequest(serviceId, overrides = {}) {
    return {
        id:            serviceId === "argumentation-tutor" ? 1 : 2,
        userId:        42,
        serviceId,
        status:        "pending",
        attempts:      0,
        nextAttemptAt: REQUESTED_AT,
        lastAttemptAt: null,
        lastError:     null,
        requestedAt:   REQUESTED_AT,
        completedAt:   null,
        ...overrides,
    };
}

describe("internal user erasure endpoints", () => {
    let server;
    let baseUrl;
    let session;
    let store;
    let processor;

    before(async () => {
        const app = express();
        app.use((req, res, next) => {
            req.session = session;
            next();
        });
        app.use(createUserErasureRouter({
            store:     { listForUser: (...args) => store.listForUser(...args), resetForRetry: (...args) => store.resetForRetry(...args) },
            processor: { processDue: (...args) => processor.processDue(...args) },
        }));
        server = await new Promise(resolve => {
            const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(() => new Promise(resolve => server.close(resolve)));

    beforeEach(() => {
        session = { uid: 1, role: "S" };
        const requests = [
            storedRequest("argumentation-tutor", { status: "done", attempts: 1, completedAt: REQUESTED_AT }),
            storedRequest("polyadic-agent", { attempts: 3, lastError: "HTTP_503" }),
        ];
        store = {
            calls: [],
            async listForUser(userId) {
                store.calls.push(["list", userId]);
                return requests;
            },
            async resetForRetry(userId) {
                store.calls.push(["reset", userId]);
                requests[1] = { ...requests[1], attempts: 0 };
                return 1;
            },
        };
        processor = {
            calls: [],
            async processDue(options) {
                processor.calls.push(options);
                requests[1] = { ...requests[1], status: "done", attempts: 1, lastError: null, completedAt: REQUESTED_AT };
                return { done: 1, retrying: 0, failed: 0 };
            },
        };
    });

    it("lists the requests of an account without internal ids", async () => {
        const response = await fetch(`${baseUrl}/api/admin/user-erasure/users/42`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.ok, true);
        assert.equal(body.userId, 42);
        assert.deepEqual(body.requests.map(request => [request.serviceId, request.status, request.attempts, request.lastError]), [
            ["argumentation-tutor", "done", 1, null],
            ["polyadic-agent", "pending", 3, "HTTP_503"],
        ]);
        assert.equal("id" in body.requests[0], false);
        assert.equal("userId" in body.requests[0], false);
        assert.deepEqual(store.calls, [["list", 42]]);
    });

    it("retries the requests that are not done and answers with their state afterwards", async () => {
        const response = await fetch(`${baseUrl}/api/admin/user-erasure/users/42/retry`, { method: "POST" });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.retried, 1);
        assert.deepEqual(store.calls, [["reset", 42], ["list", 42]]);
        assert.deepEqual(processor.calls, [{ userId: 42 }]);
        assert.deepEqual(body.requests.map(request => request.status), ["done", "done"]);
    });

    it("does not process anything when no request was reset", async () => {
        store.resetForRetry = async () => 0;

        const response = await fetch(`${baseUrl}/api/admin/user-erasure/users/42/retry`, { method: "POST" });

        assert.equal(response.status, 200);
        assert.equal((await response.json()).retried, 0);
        assert.deepEqual(processor.calls, []);
    });

    it("rejects an invalid user id", async () => {
        for (const id of ["0", "abc", "1.5", "99999999999"]) {
            const response = await fetch(`${baseUrl}/api/admin/user-erasure/users/${id}`);
            assert.equal(response.status, 400, id);
            assert.deepEqual(await response.json(), { ok: false, error: "invalid_user_id" });
        }
        assert.deepEqual(store.calls, []);
    });

    it("requires a super administrator session", async () => {
        session = { uid: 7, role: "P" };
        let response = await fetch(`${baseUrl}/api/admin/user-erasure/users/42`);
        assert.equal(response.status, 403);

        session = {};
        response = await fetch(`${baseUrl}/api/admin/user-erasure/users/42/retry`, { method: "POST" });
        assert.equal(response.status, 401);
        assert.deepEqual(store.calls, []);
    });

    it("is case-sensitive like the NGINX block", async () => {
        const response = await fetch(`${baseUrl}/API/admin/user-erasure/users/42`);
        assert.equal(response.status, 404);
    });

    it("answers 500 without details when the store fails", async () => {
        store.listForUser = async () => {
            throw new Error("connection refused to db.internal");
        };

        const response = await fetch(`${baseUrl}/api/admin/user-erasure/users/42`);

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { ok: false, error: "internal_error" });
    });
});
