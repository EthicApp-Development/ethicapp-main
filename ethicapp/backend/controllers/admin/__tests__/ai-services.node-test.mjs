import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, beforeEach, describe, it } from "node:test";
import express from "express";

import { createAiServicesRouter } from "../ai-services.js";
import { AiAdditionsClient } from "../../../services/ai-additions-client.service.js";
import { createAiServicesCatalogService } from "../../../services/ai-services-catalog.service.js";

// Values that must never appear in a response or a log line.
const CLIENT_SECRET = "client-secret-that-must-not-leak";
const ACCESS_TOKEN = "access-token-that-must-not-leak";
const ENV = Object.freeze({
    AI_ADDITIONS_KEYCLOAK_CLIENT_ID:     "ethicapp-platform",
    AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: CLIENT_SECRET,
});
const STORED_CONNECTION = Object.freeze({ baseUrl: "http://ai.stored", keycloakPublicUrl: null });
const TOKEN_PATH = "/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/token";

const ADAPTER_CATALOG = Object.freeze({
    services: [
        { id: "mock-chat-agent", description: "Mock", development: true, requires: [] },
        { id: "polyadic-devils-advocate", description: "Devil's advocate", requires: ["polyadic-agent"] },
        { id: "argumentation-tutor-system", description: "ATS", requires: ["argumentation-tutor"] },
        { id: "polyadic-second", description: "Second Polyadic adapter", requires: ["polyadic-agent"] },
    ],
});

function catalogService(id, overrides = {}) {
    return {
        id,
        name:           `Name of ${id}`,
        description:    `Description of ${id}`,
        usesLlm:        true,
        descriptorPath: `/${id}/api/capabilities`,
        apiBasePath:    `/${id}/api`,
        status:         "available",
        ...overrides,
    };
}

const CATALOG_BODY = Object.freeze({
    contractVersion: "1",
    services:        [
        catalogService("polyadic-agent"),
        catalogService("argumentation-tutor", { status: "unavailable", usesLlm: false }),
        catalogService("case-analyst"),
    ],
});

function textResponse(text, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function jsonResponse(body, status = 200) {
    return textResponse(JSON.stringify(body), status);
}

// A response that never comes: it only ends when the client aborts.
function hang(options) {
    return new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
    });
}

// A fake AI Additions behind `fetch`: the token endpoint and the catalog.
function fakeAiAdditions({
    token = () => jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 300 }),
    catalog = () => jsonResponse(CATALOG_BODY),
} = {}) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith(TOKEN_PATH)) {
            return token(url, options);
        }
        if (url.endsWith("/catalog/v1/services")) {
            return catalog(url, options);
        }
        return textResponse("not found", 404);
    };
    return { calls, fetchImpl };
}

function superAdminSession(overrides = {}) {
    return { uid: 7, role: "S", authUid: 7, authRole: "S", impersonating: false, ...overrides };
}

let logs;
const originalConsole = {};

beforeEach(() => {
    logs = [];
    for (const level of ["log", "info", "warn", "error"]) {
        originalConsole[level] = console[level];
        console[level] = (...args) => logs.push(args.map(String).join(" "));
    }
});

afterEach(() => {
    for (const [level, fn] of Object.entries(originalConsole)) {
        console[level] = fn;
    }
    for (const line of logs) {
        assert.equal(line.includes(CLIENT_SECRET), false, `a log line leaks the client secret: ${line}`);
        assert.equal(line.includes(ACCESS_TOKEN), false, `a log line leaks the token: ${line}`);
    }
});

function buildService({
    fetchImpl,
    getConnection = async () => STORED_CONNECTION,
    env = ENV,
    ...options
}) {
    const client = new AiAdditionsClient({ env, fetchImpl, getConnection });
    return createAiServicesCatalogService({
        client,
        loadAdapterCatalog: async () => ADAPTER_CATALOG,
        ...options,
    });
}

async function request(service, {
    method = "GET",
    path,
    session = superAdminSession(),
    headers = {},
    body,
}) {
    const app = express();
    app.use((req, res, next) => {
        if (session) {
            req.session = { ...session };
        }
        next();
    });
    app.use(createAiServicesRouter({ catalogService: service }));

    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();

    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            redirect: "manual",
            headers:  {
                Accept: "application/json",
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        assert.equal(text.includes(CLIENT_SECRET), false, "the response leaks the client secret");
        assert.equal(text.includes(ACCESS_TOKEN), false, "the response leaks the token");
        return { status: response.status, body: text ? JSON.parse(text) : null };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

function getCatalog(service, options = {}) {
    return request(service, { path: "/api/admin/ai-services/catalog?locale=es_CL", ...options });
}

function postTest(service, body, options = {}) {
    return request(service, {
        method: "POST",
        path:   "/api/admin/ai-services/connection-test",
        body,
        ...options,
    });
}

// A port that was just released, so connecting to it is refused.
async function closedPort() {
    const server = http.createServer();
    server.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

describe("GET /api/admin/ai-services/catalog", () => {
    it("returns the catalog with availability and the adapters each service enables", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();

        const { status, body } = await getCatalog(buildService({ fetchImpl }));

        assert.equal(status, 200);
        assert.deepEqual(body, {
            ok:              true,
            contractVersion: "1",
            locale:          "es_CL",
            services:        [
                {
                    id:          "polyadic-agent",
                    name:        "Name of polyadic-agent",
                    description: "Description of polyadic-agent",
                    usesLlm:     true,
                    status:      "available",
                    available:   true,
                    adapters:    [
                        { id: "polyadic-devils-advocate", description: "Devil's advocate" },
                        { id: "polyadic-second", description: "Second Polyadic adapter" },
                    ],
                },
                {
                    id:          "argumentation-tutor",
                    name:        "Name of argumentation-tutor",
                    description: "Description of argumentation-tutor",
                    usesLlm:     false,
                    status:      "unavailable",
                    available:   false,
                    adapters:    [{ id: "argumentation-tutor-system", description: "ATS" }],
                },
                {
                    id:          "case-analyst",
                    name:        "Name of case-analyst",
                    description: "Description of case-analyst",
                    usesLlm:     true,
                    status:      "available",
                    available:   true,
                    adapters:    [],
                },
            ],
        });

        assert.equal(calls[0].url, `http://ai.stored${TOKEN_PATH}`);
        assert.equal(calls[1].url, "http://ai.stored/catalog/v1/services");
        assert.equal(calls[1].options.method, "GET");
        assert.equal(calls[1].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
        assert.equal(calls[1].options.headers["Accept-Language"], "es-CL");
    });

    it("maps every non-Spanish locale to en_US and en-US", async () => {
        for (const [query, header] of [["en_US", undefined], ["fr_FR", undefined], ["", "de-DE"]]) {
            const { calls, fetchImpl } = fakeAiAdditions();
            const { body } = await getCatalog(buildService({ fetchImpl }), {
                path:    `/api/admin/ai-services/catalog?locale=${query}`,
                headers: header ? { "Accept-Language": header } : {},
            });
            assert.equal(body.locale, "en_US");
            assert.equal(calls.at(-1).options.headers["Accept-Language"], "en-US");
        }
    });

    it("falls back to the Accept-Language header when no locale is given", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const { body } = await getCatalog(buildService({ fetchImpl }), {
            path:    "/api/admin/ai-services/catalog",
            headers: { "Accept-Language": "es-AR,es;q=0.9" },
        });
        assert.equal(body.locale, "es_CL");
        assert.equal(calls.at(-1).options.headers["Accept-Language"], "es-CL");
    });

    it("answers not_configured without any request when no connection is stored", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl, getConnection: async () => null });

        const { status, body } = await getCatalog(service);

        assert.equal(status, 200);
        assert.deepEqual(body, { ok: false, error: "not_configured" });
        assert.equal(calls.length, 0);
    });

    it("answers unreachable on a network failure, a gateway error or a timeout", async () => {
        const cases = [
            fakeAiAdditions({ token: () => { throw new TypeError("fetch failed"); } }),
            fakeAiAdditions({ catalog: () => textResponse("<html>Bad gateway</html>", 502) }),
            fakeAiAdditions({ catalog: (url, options) => hang(options) }),
        ];

        for (const { fetchImpl } of cases) {
            const service = buildService({ fetchImpl, catalogDeadlineMs: 50 });
            const { body } = await getCatalog(service);
            assert.deepEqual(body, { ok: false, error: "unreachable" });
        }
    });

    it("answers unauthorized when the token or the catalog is refused", async () => {
        const cases = [
            { fetchImpl: fakeAiAdditions({ token: () => jsonResponse({ error: "invalid_client" }, 401) }).fetchImpl },
            { fetchImpl: fakeAiAdditions({ catalog: () => jsonResponse({ detail: "no" }, 401) }).fetchImpl },
            { fetchImpl: fakeAiAdditions({ catalog: () => jsonResponse({ detail: "no" }, 403) }).fetchImpl },
            { fetchImpl: fakeAiAdditions().fetchImpl, env: { AI_ADDITIONS_KEYCLOAK_CLIENT_ID: "ethicapp-platform" } },
        ];

        for (const options of cases) {
            const { body } = await getCatalog(buildService(options));
            assert.deepEqual(body, { ok: false, error: "unauthorized" });
        }
    });

    it("answers invalid_response for a body that is not the catalog contract", async () => {
        const invalidBodies = [
            () => textResponse("<html>not json</html>"),
            () => jsonResponse({ ...CATALOG_BODY, contractVersion: "2" }),
            () => jsonResponse({ contractVersion: "1" }),
            () => jsonResponse({ contractVersion: "1", services: [{ id: "polyadic-agent", name: "x" }] }),
            () => jsonResponse({
                contractVersion: "1",
                services:        [catalogService("polyadic-agent", { status: "maybe" })],
            }),
            () => textResponse("missing", 404),
        ];

        for (const catalog of invalidBodies) {
            const { fetchImpl } = fakeAiAdditions({ catalog });
            const { body } = await getCatalog(buildService({ fetchImpl }));
            assert.deepEqual(body, { ok: false, error: "invalid_response" });
        }

        const { fetchImpl } = fakeAiAdditions({ token: () => jsonResponse({ expires_in: 300 }) });
        const { body } = await getCatalog(buildService({ fetchImpl }));
        assert.deepEqual(body, { ok: false, error: "invalid_response" });
    });

    it("logs failures by code only", async () => {
        const { fetchImpl } = fakeAiAdditions({
            catalog: () => jsonResponse({ detail: `bad ${ACCESS_TOKEN}` }, 401),
        });

        await getCatalog(buildService({ fetchImpl }));

        assert.deepEqual(logs, ["[ai-services] catalog read failed: error=unauthorized status=401"]);
    });

    it("answers 500 when the stored connection cannot be read", async () => {
        const { fetchImpl } = fakeAiAdditions();
        const service = buildService({
            fetchImpl,
            getConnection: async () => { throw Object.assign(new Error("db down"), { code: "ECONNREFUSED" }); },
        });

        const { status, body } = await getCatalog(service);

        assert.equal(status, 500);
        assert.deepEqual(body, { ok: false, error: "internal_error" });
    });

    it("rejects sessions without role S", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl });

        const teacher = await getCatalog(service, { session: superAdminSession({ role: "P", authRole: "P" }) });
        const anonymous = await getCatalog(service, { session: null });

        assert.equal(teacher.status, 403);
        assert.deepEqual(teacher.body, { ok: false, error: "forbidden" });
        assert.equal(anonymous.status, 401);
        assert.equal(calls.length, 0);
    });

    it("accepts a super-admin who is impersonating a teacher", async () => {
        const { fetchImpl } = fakeAiAdditions();
        const { status, body } = await getCatalog(buildService({ fetchImpl }), {
            session: superAdminSession({ uid: 42, role: "P", impersonating: true }),
        });
        assert.equal(status, 200);
        assert.equal(body.ok, true);
    });
});

describe("POST /api/admin/ai-services/connection-test", () => {
    it("obtains a token and reads the catalog from the given URLs without the stored connection", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        let storedReads = 0;
        const service = buildService({
            fetchImpl,
            getConnection: async () => { storedReads += 1; return STORED_CONNECTION; },
        });

        const { status, body } = await postTest(service, {
            baseUrl:           "https://ai.example.org/prefix/",
            keycloakPublicUrl: "https://auth.example.org/keycloak",
        }, { headers: { "Accept-Language": "es-CL" } });

        assert.equal(status, 200);
        assert.deepEqual(body, {
            ok:           true,
            token:        { ok: true },
            catalog:      { ok: true },
            serviceCount: 3,
        });
        assert.deepEqual(calls.map(call => call.url), [
            `https://ai.example.org/prefix${TOKEN_PATH}`,
            "https://ai.example.org/prefix/catalog/v1/services",
        ]);
        assert.equal(calls[1].options.headers["Accept-Language"], "es-CL");
        assert.equal(storedReads, 0);
    });

    it("does not reuse or fill the shared client's token cache", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl });

        await getCatalog(service);
        await postTest(service, { baseUrl: "http://ai.stored" });
        await getCatalog(service);

        const tokenRequests = calls.filter(call => call.url.endsWith(TOKEN_PATH));
        assert.equal(tokenRequests.length, 2);
    });

    it("skips the catalog when no token was obtained: unreachable host", async () => {
        const port = await closedPort();
        const client = new AiAdditionsClient({ env: ENV, getConnection: async () => null });
        const service = createAiServicesCatalogService({
            client,
            loadAdapterCatalog: async () => ADAPTER_CATALOG,
        });

        const { status, body } = await postTest(service, { baseUrl: `http://127.0.0.1:${port}` });

        assert.equal(status, 200);
        assert.deepEqual(body, {
            ok:           false,
            token:        { ok: false, error: "unreachable" },
            catalog:      { ok: false, skipped: true },
            serviceCount: null,
        });
    });

    it("skips the catalog when no token was obtained: refused or broken token response", async () => {
        const cases = [
            [fakeAiAdditions({ token: () => jsonResponse({ error: "unauthorized_client" }, 401) }), "unauthorized"],
            [fakeAiAdditions({ token: () => textResponse("<html>Keycloak</html>") }), "invalid_response"],
            [fakeAiAdditions({ token: () => textResponse("no realm", 404) }), "invalid_response"],
            [fakeAiAdditions({ token: (url, options) => hang(options) }), "unreachable"],
        ];

        for (const [{ calls, fetchImpl }, error] of cases) {
            // The token request's own timeout (minimum 1 s) aborts the hanging
            // fake after the step's deadline has already answered.
            const service = buildService({
                fetchImpl,
                env:                 { ...ENV, AI_ADDITIONS_HTTP_TIMEOUT_MS: "1000" },
                tokenStepDeadlineMs: 50,
            });
            const { body } = await postTest(service, { baseUrl: "http://ai.example.org" });
            assert.deepEqual(body, {
                ok:           false,
                token:        { ok: false, error },
                catalog:      { ok: false, skipped: true },
                serviceCount: null,
            });
            assert.equal(calls.some(call => call.url.endsWith("/catalog/v1/services")), false);
        }
    });

    it("reports a missing client secret as unauthorized without any request", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl, env: {} });

        const { body } = await postTest(service, { baseUrl: "http://ai.example.org" });

        assert.deepEqual(body.token, { ok: false, error: "unauthorized" });
        assert.deepEqual(body.catalog, { ok: false, skipped: true });
        assert.equal(calls.length, 0);
    });

    it("reports each catalog failure after a valid token", async () => {
        const cases = [
            [() => jsonResponse({ detail: "no" }, 401), "unauthorized"],
            [() => jsonResponse({ ...CATALOG_BODY, contractVersion: "0" }), "invalid_response"],
            [() => textResponse("<html></html>"), "invalid_response"],
            [() => textResponse("down", 503), "unreachable"],
            [() => { throw new TypeError("fetch failed"); }, "unreachable"],
            [(url, options) => hang(options), "unreachable"],
        ];

        for (const [catalog, error] of cases) {
            const { fetchImpl } = fakeAiAdditions({ catalog });
            const service = buildService({ fetchImpl, catalogStepDeadlineMs: 50 });
            const { status, body } = await postTest(service, { baseUrl: "http://ai.example.org" });
            assert.equal(status, 200);
            assert.deepEqual(body, {
                ok:           false,
                token:        { ok: true },
                catalog:      { ok: false, error },
                serviceCount: null,
            });
        }
    });

    it("rejects URLs that are not http(s) bases with an explicit authority", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl });
        const invalidBodies = [
            [{}, "baseUrl"],
            [{ baseUrl: 42 }, "baseUrl"],
            [{ baseUrl: "" }, "baseUrl"],
            [{ baseUrl: "ftp://ai.example.org" }, "baseUrl"],
            [{ baseUrl: "http:ai.example.org" }, "baseUrl"],
            [{ baseUrl: "http:///ai.example.org" }, "baseUrl"],
            [{ baseUrl: "https://user:pass@ai.example.org" }, "baseUrl"],
            [{ baseUrl: "https://@ai.example.org" }, "baseUrl"],
            [{ baseUrl: "https://ai.example.org/base?x=1" }, "baseUrl"],
            [{ baseUrl: "https://ai.example.org/#top" }, "baseUrl"],
            [{ baseUrl: "https://ai.example.org/a/../b" }, "baseUrl"],
            [{ baseUrl: "https://ai.example.org:99999" }, "baseUrl"],
            [{ baseUrl: "https://ai.example.org", keycloakPublicUrl: "javascript:alert(1)" }, "keycloakPublicUrl"],
            [{ baseUrl: "https://ai.example.org", keycloakPublicUrl: "https://kc.example.org?realm=x" }, "keycloakPublicUrl"],
        ];

        for (const [requestBody, field] of invalidBodies) {
            const { status, body } = await postTest(service, requestBody);
            assert.equal(status, 400, JSON.stringify(requestBody));
            assert.deepEqual(body, { ok: false, error: "invalid_request", field });
        }
        assert.equal(calls.length, 0);
    });

    it("accepts path prefixes, trailing slashes and an empty Keycloak URL", async () => {
        const { fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl });

        for (const requestBody of [
            { baseUrl: "http://ethicapp-ai-additions:8010" },
            { baseUrl: "HTTPS://AI.example.org/base/", keycloakPublicUrl: "" },
            { baseUrl: "https://ai.example.org", keycloakPublicUrl: null },
        ]) {
            const { status, body } = await postTest(service, requestBody);
            assert.equal(status, 200, JSON.stringify(requestBody));
            assert.equal(body.ok, true);
        }
    });

    it("rejects sessions without role S before reading the body", async () => {
        const { calls, fetchImpl } = fakeAiAdditions();
        const service = buildService({ fetchImpl });

        const { status, body } = await postTest(
            service,
            { baseUrl: "http://ai.example.org" },
            { session: superAdminSession({ role: "A", authRole: "A" }) }
        );

        assert.equal(status, 403);
        assert.deepEqual(body, { ok: false, error: "forbidden" });
        assert.equal(calls.length, 0);
    });
});
