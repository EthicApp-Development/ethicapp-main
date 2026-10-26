import assert from "node:assert/strict";
import ejs from "ejs";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import impersonationRouter from "../impersonation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const homeView = path.join(__dirname, "../../../views/home.ejs");

function impersonatingAdminSession(overrides = {}) {
    return {
        uid:           42,
        role:          "P",
        authUid:       7,
        authRole:      "S",
        impersonating: true,
        ...overrides,
    };
}

// Runs one request against the router with a fake session and reports what
// happened to it.
async function postStop(session, headers = {}, path = "/api/admin/impersonation/stop") {
    const state = { destroyed: false };
    const app = express();
    app.use((req, res, next) => {
        if (session) {
            req.session = {
                ...session,
                destroy(callback) {
                    state.destroyed = true;
                    callback(session.destroyError || null);
                },
            };
        }
        next();
    });
    app.use(impersonationRouter);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();

    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method:   "POST",
            redirect: "manual",
            headers:  { Accept: "text/html", ...headers },
        });
        const body = await response.text();
        return { response, body, ...state };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

describe("POST /api/admin/impersonation/stop", () => {
    it("ends the impersonation and sends a form post back to the console", async () => {
        const { response, destroyed } = await postStop(impersonatingAdminSession());

        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), "/mng/users");
        assert.equal(destroyed, true);
        const cookie = response.headers.get("set-cookie") || "";
        assert.match(cookie, /^ethicapp\.sid=;/);
        assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
        assert.match(cookie, /Path=\//);
    });

    it("answers JSON to callers that ask for it", async () => {
        const { response, body, destroyed } = await postStop(
            impersonatingAdminSession(),
            { Accept: "application/json" },
        );

        assert.equal(response.status, 200);
        assert.deepEqual(JSON.parse(body), { ok: true, redirectTo: "/mng/users" });
        assert.equal(destroyed, true);
    });

    it("accepts a same-origin form post", async () => {
        const { response, destroyed } = await postStop(
            impersonatingAdminSession(),
            { Origin: "http://127.0.0.1" },
        );

        assert.equal(response.status, 303);
        assert.equal(destroyed, true);
    });

    it("sends an admin who is not impersonating back without touching the session", async () => {
        const { response, destroyed } = await postStop(
            impersonatingAdminSession({ uid: 7, role: "S", impersonating: false }),
        );

        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), "/mng/users");
        assert.equal(destroyed, false);
    });

    it("rejects a teacher session", async () => {
        const teacherSession = { uid: 42, role: "P", authUid: 42, authRole: "P" };
        const { response, destroyed } = await postStop(teacherSession);

        assert.equal(response.status, 403);
        assert.equal(destroyed, false);
    });

    it("rejects a request without a session user", async () => {
        const { response, destroyed } = await postStop({});

        assert.equal(response.status, 401);
        assert.equal(destroyed, false);
    });

    it("rejects a cross-origin post", async () => {
        const { response, destroyed } = await postStop(
            impersonatingAdminSession(),
            { Origin: "https://evil.example" },
        );

        assert.equal(response.status, 403);
        assert.equal(destroyed, false);
    });

    it("reports a failure to destroy the session", async () => {
        const session = impersonatingAdminSession({ destroyError: new Error("redis down") });
        const { response } = await postStop(session);

        assert.equal(response.status, 500);
    });
});

describe("letter case of the impersonation routes", () => {
    // NGINX blocks or exposes /api/admin/ by its exact spelling, so the router
    // must not answer other spellings that the edge would proxy.
    it("answers other spellings with 404", async () => {
        for (const path of [
            "/API/admin/impersonation/stop",
            "/api/Admin/impersonation/stop",
            "/api/admin/impersonation/professor/12".toUpperCase(),
            "/api/Admin/impersonation/professor/12",
        ]) {
            const { response, destroyed } = await postStop(
                impersonatingAdminSession(),
                { Accept: "application/json" },
                path,
            );
            assert.equal(response.status, 404, path);
            assert.equal(destroyed, false);
        }
    });
});

describe("home.ejs back to management console", () => {
    const render = (locals) => ejs.renderFile(homeView, {
        recaptchaEnabled: false,
        recaptchaSiteKey: "",
        ...locals,
    });

    it("posts to the stop endpoint while an admin impersonates", async () => {
        const html = await render({ impersonating: true, authRole: "S" });

        const form = '<form method="post" action="/api/admin/impersonation/stop"';
        assert.ok(html.includes(form));
        assert.match(html.slice(html.indexOf(form)), /^[^>]*>\s*<button type="submit"/);
        assert.doesNotMatch(html, /href="\/mng\/users"/);
    });

    it("shows no button outside an impersonation", async () => {
        const html = await render({ impersonating: false, authRole: "P" });

        assert.doesNotMatch(html, /impersonation\/stop/);
    });
});
