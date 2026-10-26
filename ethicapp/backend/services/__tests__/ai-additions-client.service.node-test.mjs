import assert from "node:assert/strict";
import test from "node:test";
import {
    AiAdditionsClient,
    AiAdditionsCredentialsMissingError,
    AiAdditionsNotConfiguredError,
    isAiAdditionsCredentialsMissing,
    isAiAdditionsNotConfigured,
} from "../ai-additions-client.service.js";

const CREDENTIALS = Object.freeze({
    AI_ADDITIONS_KEYCLOAK_CLIENT_ID:     "ethicapp-platform",
    AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "secret",
});
const TOKEN_URL = "http://ai.local/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/token";

function jsonResponse(body, status = 200) {
    return {
        ok:   status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    };
}

// A fetch that fails the test if it is ever called.
async function forbiddenFetch(url) {
    throw new Error(`no request may leave the host, got ${url}`);
}

function recordingFetch(calls, { serviceResponse = () => jsonResponse({ ok: true }) } = {}) {
    let tokens = 0;
    return async (url, options) => {
        calls.push({ url, options });
        if (url.includes("/protocol/openid-connect/token")) {
            tokens += 1;
            return jsonResponse({ access_token: `token-${tokens}`, expires_in: 300 });
        }
        return serviceResponse(url, options);
    };
}

function makeClient({ connection = { baseUrl: "http://ai.local", keycloakPublicUrl: null }, ...options } = {}) {
    return new AiAdditionsClient({
        env:           { ...CREDENTIALS },
        getConnection: async () => connection,
        ...options,
    });
}

test("requests a Keycloak token through base_url and sends it as bearer auth", async () => {
    const calls = [];
    const client = makeClient({ fetchImpl: recordingFetch(calls) });

    const result = await client.requestJson("/sessions", { basePath: "/argumentation-tutor/api/v2" });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0].url, TOKEN_URL);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body.includes("grant_type=client_credentials"), true);
    assert.equal(calls[1].url, "http://ai.local/argumentation-tutor/api/v2/sessions");
    assert.equal(calls[1].options.headers.Authorization, "Bearer token-1");
});

test("keycloak_public_url only sets the issuer: tokens and JWKS go through base_url", async () => {
    const client = makeClient({
        connection: { baseUrl: "http://ai-additions:8010/", keycloakPublicUrl: "https://ai.example.org/keycloak/" },
        env:        { ...CREDENTIALS, AI_ADDITIONS_KEYCLOAK_REALM: "custom-realm" },
        fetchImpl:  forbiddenFetch,
    });

    const endpoints = await client.getEndpoints();

    assert.equal(endpoints.baseUrl, "http://ai-additions:8010");
    assert.equal(endpoints.tokenUrl,
        "http://ai-additions:8010/keycloak/realms/custom-realm/protocol/openid-connect/token");
    assert.equal(endpoints.jwksUrl,
        "http://ai-additions:8010/keycloak/realms/custom-realm/protocol/openid-connect/certs");
    assert.equal(endpoints.issuer, "https://ai.example.org/keycloak/realms/custom-realm");
});

test("without keycloak_public_url the issuer is base_url/keycloak", async () => {
    const client = makeClient({ fetchImpl: forbiddenFetch });

    const endpoints = await client.getEndpoints();

    assert.equal(endpoints.issuer, "http://ai.local/keycloak/realms/ethicapp-ai-additions");
    assert.equal(endpoints.tokenUrl, TOKEN_URL);
});

test("without a connection every call fails with not_configured and no request leaves the host", async () => {
    for (const authenticated of [true, false]) {
        const client = makeClient({ connection: null, fetchImpl: forbiddenFetch });

        await assert.rejects(
            () => client.requestJson("/rooms", { basePath: "/polyadic-agent/api", authenticated }),
            (error) => {
                assert.ok(error instanceof AiAdditionsNotConfiguredError);
                assert.equal(error.code, "not_configured");
                assert.equal(isAiAdditionsNotConfigured(error), true);
                return true;
            }
        );
    }

    const client = makeClient({ connection: null, fetchImpl: forbiddenFetch });
    await assert.rejects(() => client.getAccessToken(), { code: "not_configured" });
    await assert.rejects(() => client.getEndpoints(), { code: "not_configured" });
    await assert.rejects(() => client.resolveServiceUrl("/case-analyst/api/v1"), { code: "not_configured" });
    assert.equal(await client.getConnectionFingerprint(), null);
});

test("a connection whose base URL is not http(s) counts as not configured", async () => {
    const client = makeClient({ connection: { baseUrl: "ftp://ai.local" }, fetchImpl: forbiddenFetch });

    await assert.rejects(() => client.requestJson("/x"), { code: "not_configured" });
});

test("paths stay relative to the connection: absolute URLs are refused", async () => {
    const client = makeClient({ fetchImpl: forbiddenFetch });

    await assert.rejects(
        () => client.requestJson("http://elsewhere.test/steal", { authenticated: false }),
        /relative to the connection/u
    );
});

test("clears the cached token and retries once on 401", async () => {
    const calls = [];
    let serviceCount = 0;
    const client = makeClient({
        fetchImpl: recordingFetch(calls, {
            serviceResponse: () => {
                serviceCount += 1;
                return serviceCount === 1 ? jsonResponse({ error: "expired" }, 401) : jsonResponse({ ok: true });
            },
        }),
    });

    const result = await client.requestJson("/rooms/status", { basePath: "/polyadic-agent/api" });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(
        calls.filter(call => !call.url.includes("/token")).map(call => call.options.headers.Authorization),
        ["Bearer token-1", "Bearer token-2"]
    );
});

test("requires client credentials for authenticated requests", async () => {
    const client = makeClient({ env: {}, fetchImpl: forbiddenFetch });

    await assert.rejects(
        () => client.requestJson("/argumentation-tutor/api/v2/sessions"),
        (error) => {
            assert.ok(error instanceof AiAdditionsCredentialsMissingError);
            assert.equal(error.code, "credentials_missing");
            assert.equal(isAiAdditionsCredentialsMissing(error), true);
            assert.match(error.message, /Missing AI_ADDITIONS_KEYCLOAK_CLIENT_ID/u);
            return true;
        }
    );
});

test("reuses the connection for connectionTtlMs and rereads it afterwards", async () => {
    let now = 1000;
    let reads = 0;
    const client = new AiAdditionsClient({
        env:             { ...CREDENTIALS },
        fetchImpl:       forbiddenFetch,
        now:             () => now,
        connectionTtlMs: 5000,
        getConnection:   async () => {
            reads += 1;
            return { baseUrl: "http://ai.local" };
        },
    });

    await client.getEndpoints();
    await client.getEndpoints();
    now += 4999;
    await client.getEndpoints();
    assert.equal(reads, 1);

    now += 2;
    await client.getEndpoints();
    assert.equal(reads, 2);
});

test("a changed connection drops the cached token and uses the new host", async () => {
    const calls = [];
    let connection = { baseUrl: "http://first.local" };
    const client = makeClient({ fetchImpl: recordingFetch(calls), connectionTtlMs: 0 });
    client.getConnection = async () => connection;

    await client.requestJson("/a", { basePath: "/svc" });
    await client.requestJson("/b", { basePath: "/svc" });
    connection = { baseUrl: "http://second.local" };
    await client.requestJson("/c", { basePath: "/svc" });

    assert.deepEqual(calls.map(call => call.url), [
        "http://first.local/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/token",
        "http://first.local/svc/a",
        "http://first.local/svc/b",
        "http://second.local/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/token",
        "http://second.local/svc/c",
    ]);
    assert.equal(calls.at(-1).options.headers.Authorization, "Bearer token-2");
});

test("a removed connection stops calls at once, cached token or not", async () => {
    const calls = [];
    let connection = { baseUrl: "http://ai.local" };
    const client = makeClient({ fetchImpl: recordingFetch(calls), connectionTtlMs: 0 });
    client.getConnection = async () => connection;

    await client.requestJson("/a");
    connection = null;
    const requestsBefore = calls.length;

    await assert.rejects(() => client.requestJson("/b"), { code: "not_configured" });
    assert.equal(calls.length, requestsBefore);
    assert.equal(client.tokenCache.token, null);
});

test("a database failure while reading the connection propagates as is", async () => {
    const client = makeClient({ fetchImpl: forbiddenFetch });
    client.getConnection = async () => { throw new Error("database down"); };

    await assert.rejects(() => client.requestJson("/a"), (error) => {
        assert.equal(isAiAdditionsNotConfigured(error), false);
        assert.match(error.message, /database down/u);
        return true;
    });
});

test("withConnection: tests an unsaved connection with its own token cache", async () => {
    const calls = [];
    const stored = makeClient({ connection: null, fetchImpl: recordingFetch(calls) });
    const candidate = stored.withConnection({
        baseUrl:           "http://candidate.local",
        keycloakPublicUrl: "https://public.example.org/keycloak",
    });

    const token = await candidate.getAccessToken();
    const catalog = await candidate.requestJson("/catalog/v1/services");

    assert.equal(token, "token-1");
    assert.deepEqual(catalog, { ok: true });
    assert.deepEqual(calls.map(call => call.url), [
        "http://candidate.local/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/token",
        "http://candidate.local/catalog/v1/services",
    ]);
    assert.equal((await candidate.getEndpoints()).issuer,
        "https://public.example.org/keycloak/realms/ethicapp-ai-additions");
    // The stored (absent) connection is untouched.
    await assert.rejects(() => stored.requestJson("/x"), { code: "not_configured" });
    assert.equal(stored.withConnection(null) instanceof AiAdditionsClient, true);
    await assert.rejects(() => stored.withConnection(null).getAccessToken(), { code: "not_configured" });
});

// ─── A token only goes to the host that issued it (PR #828 review) ───────────

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

// Tokens name the host that issued them; every service call records the host
// it went to and the host of the token it carried.
function hostBoundFetch({ onToken = async () => {}, onService = () => null } = {}) {
    const serviceCalls = [];
    let issued = 0;
    const fetchImpl = async (url, options) => {
        const host = new URL(url).host;
        if (url.includes("/protocol/openid-connect/token")) {
            issued += 1;
            await onToken(host, issued);
            return jsonResponse({ access_token: `${host}#${issued}`, expires_in: 300 });
        }
        const authorization = options.headers.Authorization ?? "";
        const call = { host, url, tokenHost: authorization.replace(/^Bearer /u, "").split("#")[0] };
        serviceCalls.push(call);
        return onService(call, serviceCalls.length) ?? jsonResponse({ ok: true });
    };
    return { fetchImpl, serviceCalls };
}

function assertTokensStayWithTheirHost(serviceCalls) {
    assert.ok(serviceCalls.length > 0);
    for (const call of serviceCalls) {
        assert.equal(call.tokenHost, call.host, `a token issued by ${call.tokenHost} was sent to ${call.host}`);
    }
}

test("a connection change at the TTL boundary never sends a token to another host", async () => {
    let now = 0;
    let connection = { baseUrl: "http://old.test" };
    const { fetchImpl, serviceCalls } = hostBoundFetch({
        // While the token for old.test is being obtained, the operator moves
        // the connection and the cached connection expires.
        onToken: async (host) => {
            if (host === "old.test") {
                connection = { baseUrl: "http://new.test" };
                now = 5001;
            }
        },
    });
    const client = makeClient({ fetchImpl, now: () => now });
    client.getConnection = async () => connection;

    await client.getEndpoints();
    now = 4999;
    await client.requestJson("/rooms", { method: "POST", basePath: "/polyadic-agent/api" });

    assertTokensStayWithTheirHost(serviceCalls);
    assert.deepEqual(serviceCalls.map(call => call.url), ["http://new.test/polyadic-agent/api/rooms"]);
});

test("a token request pending during a connection change is not used for the new host", async () => {
    let connection = { baseUrl: "http://old.test" };
    const heldOldToken = deferred();
    const { fetchImpl, serviceCalls } = hostBoundFetch({
        onToken: async (host) => {
            if (host === "old.test") {
                await heldOldToken.promise;
            }
        },
    });
    const client = makeClient({ fetchImpl, connectionTtlMs: 0 });
    client.getConnection = async () => connection;

    const first = client.requestJson("/a");
    await new Promise(resolve => setImmediate(resolve));
    connection = { baseUrl: "http://new.test" };
    await client.requestJson("/b");
    heldOldToken.resolve();
    await first;

    assertTokensStayWithTheirHost(serviceCalls);
    assert.deepEqual(serviceCalls.map(call => call.host), ["new.test", "new.test"]);
    assert.equal(client.tokenCache.key.startsWith("http://new.test"), true, "the late token did not replace the current one");
});

test("the retry after a 401 uses one snapshot of the connection current at retry time", async () => {
    let connection = { baseUrl: "http://old.test" };
    const { fetchImpl, serviceCalls } = hostBoundFetch({
        onService: (call, count) => {
            if (count === 1) {
                connection = { baseUrl: "http://new.test" };
                return jsonResponse({ error: "expired" }, 401);
            }
            return null;
        },
    });
    const client = makeClient({ fetchImpl, connectionTtlMs: 0 });
    client.getConnection = async () => connection;

    const result = await client.requestJson("/rooms");

    assert.deepEqual(result, { ok: true });
    assertTokensStayWithTheirHost(serviceCalls);
    assert.deepEqual(serviceCalls.map(call => call.host), ["old.test", "new.test"]);
});

test("a connection that keeps changing fails the request instead of mixing hosts", async () => {
    let flips = 0;
    const { fetchImpl, serviceCalls } = hostBoundFetch();
    const client = makeClient({ fetchImpl, connectionTtlMs: 0 });
    client.getConnection = async () => {
        flips += 1;
        return { baseUrl: `http://host-${flips}.test` };
    };

    await assert.rejects(() => client.requestJson("/rooms"), /kept changing/u);
    assert.deepEqual(serviceCalls, []);
});

test("withConnection: the bound connection never changes between snapshots", async () => {
    const { fetchImpl, serviceCalls } = hostBoundFetch();
    const stored = makeClient({ fetchImpl, connection: { baseUrl: "http://stored.test" } });
    const candidate = stored.withConnection({ baseUrl: "http://candidate.test" });

    await candidate.requestJson("/catalog/v1/services");
    await stored.requestJson("/x");

    assertTokensStayWithTheirHost(serviceCalls);
    assert.deepEqual(serviceCalls.map(call => call.host), ["candidate.test", "stored.test"]);
});
