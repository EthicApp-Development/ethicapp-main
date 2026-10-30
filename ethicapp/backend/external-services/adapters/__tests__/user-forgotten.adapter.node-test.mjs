// The `user-forgotten` handlers of the tutor and Polyadic adapters (#876):
// each calls its service's per-user erasure and reports the counts; a
// failure is thrown, for the erasure request processor to record and retry.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { register as registerAts } from "../ats-feedback.adapter.js";
import { register as registerPolyadic } from "../polyadic-bridge.adapter.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"));

function createClient(respond) {
    const requests = [];
    return {
        requests,
        async getEndpoints() {
            return { baseUrl: "http://ai.local" };
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, options });
            return respond(pathname, options);
        },
    };
}

async function registerHandlers(register, client) {
    const subscribers = new Map();
    await register({
        service:                 { id: "adapter-under-test" },
        subscribe:               (hookName, handler) => subscribers.set(hookName, handler),
        publishStudentResult:    async () => null,
        publishGroupChatMessage: async () => ({ savedMessage: { id: 1 } }),
        aiAdditionsClient:       client,
    });

    const callbacks = [];
    return {
        callbacks,
        dispatch(hookName, context) {
            const handler = subscribers.get(hookName);
            assert.equal(typeof handler, "function", `Missing subscriber for ${hookName}`);
            return handler(context, { callback: async (result) => callbacks.push(result) });
        },
    };
}

test("the tutor and Polyadic adapters declare user-forgotten as a global hook", () => {
    for (const id of ["argumentation-tutor-system", "polyadic-devils-advocate"]) {
        const entry = manifest.services.find(service => service.id === id);
        assert.ok(entry.hooks.includes("user-forgotten"), id);
        assert.deepEqual(entry.globalHooks, ["user-forgotten"], id);
    }
});

test("tutor: user-forgotten calls the per-user erasure with the user id as a string", async () => {
    const client = createClient(() => ({
        user_id: "42", sessions: 2, history_entries: 3, tasks: 4, task_keys: 7, celery_results: 1,
    }));
    const handlers = await registerHandlers(registerAts, client);

    const result = await handlers.dispatch("user-forgotten", { userId: 42 });

    assert.deepEqual(client.requests.map(({ pathname, options }) => [
        options.method, options.basePath, pathname, options.body,
    ]), [["DELETE", "/argumentation-tutor/api/v2", "/users/42/data", null]]);
    assert.deepEqual(result.payload, {
        userId: "42", sessions: 2, historyEntries: 3, tasks: 4, taskKeys: 7, celeryResults: 1,
    });
    assert.equal(handlers.callbacks.at(-1).status, "completed");
});

test("tutor: user-forgotten throws the client's error, without reporting completion", async () => {
    const client = createClient(() => {
        throw Object.assign(new Error("HTTP 503 request failed."), { statusCode: 503 });
    });
    const handlers = await registerHandlers(registerAts, client);

    await assert.rejects(handlers.dispatch("user-forgotten", { userId: 42 }), { statusCode: 503 });
    assert.equal(handlers.callbacks.length, 0);
});

test("tutor: user-forgotten refuses an invalid user id before any request", async () => {
    const client = createClient(() => ({}));
    const handlers = await registerHandlers(registerAts, client);

    await assert.rejects(handlers.dispatch("user-forgotten", { userId: "abc" }), { code: "invalid_user_id" });
    assert.equal(client.requests.length, 0);
});

test("Polyadic: user-forgotten calls the per-participant erasure", async () => {
    const client = createClient(() => ({
        participant_id: "42", messages_erased: 4, messages_redacted: 2, room_sessions: 2, active_rooms: 1,
    }));
    const handlers = await registerHandlers(registerPolyadic, client);

    const result = await handlers.dispatch("user-forgotten", { userId: 42 });

    assert.deepEqual(client.requests.map(({ pathname, options }) => [
        options.method, options.basePath, pathname,
    ]), [["DELETE", "/polyadic-agent/api", "/participants/42/data"]]);
    assert.deepEqual(result.payload, {
        participantId: "42", messagesErased: 4, messagesRedacted: 2, roomSessions: 2, activeRooms: 1,
    });
    assert.equal(handlers.callbacks.at(-1).status, "completed");
});

test("Polyadic: user-forgotten throws the client's error", async () => {
    const client = createClient(() => {
        throw Object.assign(new Error("The AI Additions connection is not configured."), {
            code: "not_configured",
        });
    });
    const handlers = await registerHandlers(registerPolyadic, client);

    await assert.rejects(handlers.dispatch("user-forgotten", { userId: 42 }), { code: "not_configured" });
    assert.equal(handlers.callbacks.length, 0);
});

test("Polyadic: user-forgotten refuses an invalid user id before any request", async () => {
    const client = createClient(() => ({}));
    const handlers = await registerHandlers(registerPolyadic, client);

    await assert.rejects(handlers.dispatch("user-forgotten", { userId: 0 }), { code: "invalid_user_id" });
    assert.equal(client.requests.length, 0);
});
