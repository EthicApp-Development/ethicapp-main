import assert from "node:assert/strict";
import test from "node:test";
import { AiAdditionsClient } from "../ai-additions-client.service.js";

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    };
}

test("AiAdditionsClient requests a Keycloak token and sends it as bearer auth", async () => {
    const calls = [];
    const client = new AiAdditionsClient({
        env: {
            AI_ADDITIONS_BASE_URL: "http://ai.local",
            AI_ADDITIONS_KEYCLOAK_BASE_URL: "http://ai.local/keycloak",
            AI_ADDITIONS_KEYCLOAK_REALM: "ethicapp-ai-additions",
            AI_ADDITIONS_KEYCLOAK_CLIENT_ID: "ethicapp-platform",
            AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "secret",
        },
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (url.includes("/protocol/openid-connect/token")) {
                return jsonResponse({ access_token: "token-a", expires_in: 300 });
            }

            return jsonResponse({ ok: true });
        },
    });

    const result = await client.requestJson("/argumentation-tutor/api/v2/sessions");

    assert.deepEqual(result, { ok: true });
    assert.equal(
        calls[0].url,
        "http://ai.local/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/token"
    );
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body.includes("grant_type=client_credentials"), true);
    assert.equal(calls[1].url, "http://ai.local/argumentation-tutor/api/v2/sessions");
    assert.equal(calls[1].options.headers.Authorization, "Bearer token-a");
});

test("AiAdditionsClient clears cached token and retries once on 401", async () => {
    const serviceAuthorizations = [];
    let tokenCount = 0;
    let serviceCount = 0;
    const client = new AiAdditionsClient({
        env: {
            AI_ADDITIONS_BASE_URL: "http://ai.local",
            AI_ADDITIONS_KEYCLOAK_CLIENT_ID: "ethicapp-platform",
            AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "secret",
        },
        fetchImpl: async (url, options) => {
            if (url.includes("/protocol/openid-connect/token")) {
                tokenCount += 1;
                return jsonResponse({ access_token: `token-${tokenCount}`, expires_in: 300 });
            }

            serviceCount += 1;
            serviceAuthorizations.push(options.headers.Authorization);
            if (serviceCount === 1) {
                return jsonResponse({ error: "expired" }, 401);
            }

            return jsonResponse({ ok: true });
        },
    });

    const result = await client.requestJson("/polyadic-agent/api/rooms/status");

    assert.deepEqual(result, { ok: true });
    assert.equal(tokenCount, 2);
    assert.deepEqual(serviceAuthorizations, ["Bearer token-1", "Bearer token-2"]);
});

test("AiAdditionsClient requires client credentials for authenticated requests", async () => {
    const client = new AiAdditionsClient({
        env: {
            AI_ADDITIONS_BASE_URL: "http://ai.local",
        },
        fetchImpl: async () => jsonResponse({ ok: true }),
    });

    await assert.rejects(
        () => client.requestJson("/argumentation-tutor/api/v2/sessions"),
        /Missing AI_ADDITIONS_KEYCLOAK_CLIENT_ID/
    );
});
