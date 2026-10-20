import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createSessionExpiryFlow,
    isExpiredSessionResponse,
    SESSION_EXPIRY_REDIRECT_DELAY_MS,
    SessionExpiryService,
    sessionExpiryInterceptor,
    SIGN_IN_PATH
} from "../session-expiry.service.js";

// $http hands interceptors a headers getter function.
function response(status, url, contentType = "application/json", data = {}) {
    return {
        status,
        data,
        config:  { url },
        headers: (name) => (name === "content-type" ? contentType : null)
    };
}

function createService() {
    const timers = [];
    const assigned = [];
    const $timeout = (callback, delayMs) => timers.push({ callback, delayMs });
    const $window = { location: { assign: (url) => assigned.push(url) } };
    const service = new SessionExpiryService($timeout, $window);

    return { service, timers, assigned };
}

const $q = { reject: (value) => Promise.reject(value) };

describe("isExpiredSessionResponse", () => {
    it("treats a 401 on an API call as an expired session", () => {
        const expired = response(401, "/designs", "application/json", { status: "expired" });
        assert.equal(isExpiredSessionResponse(expired), true);
        assert.equal(isExpiredSessionResponse(response(401, "activities/57/full_state")), true);
    });

    it("ignores auth endpoints, which handle their own 401s", () => {
        assert.equal(isExpiredSessionResponse(response(401, "/api/auth/login")), false);
        assert.equal(isExpiredSessionResponse(response(401, "/auth/session/check")), false);
    });

    it("treats an HTML page delivered to an API call as an expired session", () => {
        const loginPage = response(200, "/designs", "text/html; charset=utf-8");
        assert.equal(isExpiredSessionResponse(loginPage), true);
    });

    it("accepts HTML for templates loaded through $http", () => {
        const template = "static/views/teacher/designs.html";
        assert.equal(isExpiredSessionResponse(response(200, template, "text/html")), false);
        const versioned = response(200, `${template}?v=3`, "text/html");
        assert.equal(isExpiredSessionResponse(versioned), false);
    });

    it("leaves other statuses and JSON responses to the caller", () => {
        for (const status of [200, 400, 403, 404, 409, 500, 502]) {
            const result = isExpiredSessionResponse(response(status, "/designs"));
            assert.equal(result, false, `status ${status}`);
        }
        assert.equal(isExpiredSessionResponse(undefined), false);
    });

    it("reads plain header objects as well as $http header getters", () => {
        const plain = {
            status:  200,
            config:  { url: "/designs" },
            headers: { "content-type": "text/html" }
        };
        assert.equal(isExpiredSessionResponse(plain), true);
    });
});

describe("session expiry flow", () => {
    it("schedules one redirect however many calls start it", () => {
        const scheduled = [];
        const flow = createSessionExpiryFlow({
            redirect: () => {},
            schedule: (callback, delayMs) => scheduled.push(delayMs)
        });

        assert.equal(flow.isStarted(), false);
        assert.equal(flow.start(), true);
        assert.equal(flow.start(), false);
        assert.equal(flow.isStarted(), true);
        assert.deepEqual(scheduled, [SESSION_EXPIRY_REDIRECT_DELAY_MS]);
    });
});

describe("sessionExpiryInterceptor", () => {
    it("concurrent expired calls show one notice and redirect once to sign-in", async () => {
        const { service, timers, assigned } = createService();
        const interceptor = sessionExpiryInterceptor($q, service);

        const failures = await Promise.allSettled([
            interceptor.responseError(response(401, "/designs")),
            interceptor.responseError(response(401, "/cases")),
            interceptor.response(response(200, "/activities", "text/html"))
        ]);

        const outcomes = failures.map(({ status }) => status);
        assert.deepEqual(outcomes, ["rejected", "rejected", "rejected"]);
        // Callers still receive the original rejection.
        assert.equal(failures[0].reason.status, 401);
        assert.equal(service.isExpired(), true);
        assert.equal(timers.length, 1);

        timers[0].callback();
        assert.deepEqual(assigned, [SIGN_IN_PATH]);
        assert.equal(service.signInPath, "/auth/login");
    });

    it("passes other failures and successful responses through untouched", async () => {
        const { service, timers } = createService();
        const interceptor = sessionExpiryInterceptor($q, service);
        const forbidden = response(403, "/designs");
        const ok = response(200, "/designs");

        const rejection = interceptor.responseError(forbidden);
        await assert.rejects(rejection, (reason) => reason === forbidden);
        assert.equal(interceptor.response(ok), ok);
        await assert.rejects(interceptor.responseError(response(401, "/api/auth/login")));

        assert.equal(service.isExpired(), false);
        assert.equal(timers.length, 0);
    });
});
