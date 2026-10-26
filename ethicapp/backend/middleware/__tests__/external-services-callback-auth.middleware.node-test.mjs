import assert from "node:assert/strict";
import test from "node:test";
import { createCallbackAuthMiddleware as createMiddleware } from "../external-services-callback-auth.middleware.js";
import { JwksCache } from "../../helpers/keycloak-jwt.helper.js";
import { AiAdditionsClient } from "../../services/ai-additions-client.service.js";

// EthicApp reaches AI Additions by an internal name; AI Additions publishes
// another URL, which is the issuer of its tokens (#814).
const CONNECTION = Object.freeze({
    baseUrl:           "http://ai-additions.internal:8010",
    keycloakPublicUrl: "https://ai.example.org/keycloak",
});
const TEST_ISSUER = "https://ai.example.org/keycloak/realms/ethicapp-ai-additions";
const TEST_AUDIENCE = "ethicapp-ai-services";
const TEST_JWKS_URL = "http://ai-additions.internal:8010/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/certs";

// The endpoints come from a real client over a fake connection store; its
// fetch fails the test if anything calls AI Additions directly.
function clientOver(getConnection) {
    return new AiAdditionsClient({
        env:             {},
        getConnection,
        connectionTtlMs: 0,
        fetchImpl:       async (url) => { throw new Error(`unexpected request to ${url}`); },
    });
}

function createCallbackAuthMiddleware({ getConnection = async () => CONNECTION, ...options } = {}) {
    const client = clientOver(getConnection);
    return createMiddleware({ getEndpoints: () => client.getEndpoints(), ...options });
}

async function generateRsaKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"]
    );
    return keyPair;
}

async function exportJwk(key, kid) {
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return { ...jwk, kid };
}

function base64urlEncode(data) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const base64 = Buffer.from(bytes).toString("base64");
    return base64.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=/gu, "");
}

async function signJwt(payload, privateKey, { kid = "test-key-1", alg = "RS256" } = {}) {
    const header = { alg, typ: "JWT", kid };
    const headerEncoded = base64urlEncode(JSON.stringify(header));
    const payloadEncoded = base64urlEncode(JSON.stringify(payload));
    const signingInput = `${headerEncoded}.${payloadEncoded}`;
    const signingData = new TextEncoder().encode(signingInput);
    const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        signingData
    );
    const signatureEncoded = base64urlEncode(new Uint8Array(signature));
    return `${signingInput}.${signatureEncoded}`;
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function buildPayload(overrides = {}) {
    const now = nowSeconds();
    return {
        iss: TEST_ISSUER,
        aud: TEST_AUDIENCE,
        azp: "polyadic-agent-api",
        sub: "service-account-polyadic-agent-api",
        exp: now + 300,
        iat: now,
        ...overrides,
    };
}

function mockRequest(headers = {}) {
    return { headers };
}

function mockResponse() {
    let statusCode;
    let body;
    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(data) {
            body = data;
        },
        get statusCode() { return statusCode; },
        get body() { return body; },
    };
    return res;
}

function buildEnv(overrides = {}) {
    return {
        EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED: "true",
        EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE: TEST_AUDIENCE,
        EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS: "30",
        ...overrides,
    };
}

test("rejects request with missing Authorization header", async () => {
    const middleware = createCallbackAuthMiddleware({
        env: buildEnv(),
        cache: new JwksCache(),
    });
    const req = mockRequest({});
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.status, "err");
    assert.equal(nextCalled, false);
});

test("rejects request with non-Bearer Authorization header", async () => {
    const middleware = createCallbackAuthMiddleware({
        env: buildEnv(),
        cache: new JwksCache(),
    });
    const req = mockRequest({ authorization: "Basic dXNlcjpwYXNz" });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("rejects request with malformed JWT", async () => {
    const middleware = createCallbackAuthMiddleware({
        env: buildEnv(),
        cache: new JwksCache({
            fetchImpl: async () => ({
                ok: true,
                json: async () => ({ keys: [] }),
            }),
        }),
    });
    const req = mockRequest({ authorization: "Bearer not.a.valid.jwt.at.all" });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("accepts valid JWT and sets req.externalServiceAuth", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-2025";
    const publicJwk = await exportJwk(publicKey, kid);

    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ keys: [publicJwk] }),
    });
    const cache = new JwksCache({ fetchImpl });

    const middleware = createCallbackAuthMiddleware({ env: buildEnv(), cache });

    const token = await signJwt(buildPayload(), privateKey, { kid });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    req.externalServiceAuth = undefined;
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.externalServiceAuth?.clientId, "polyadic-agent-api");
    assert.equal(req.externalServiceAuth?.iss, TEST_ISSUER);
});

test("rejects expired JWT", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-expired";
    const publicJwk = await exportJwk(publicKey, kid);

    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ keys: [publicJwk] }),
    });
    const cache = new JwksCache({ fetchImpl });

    const middleware = createCallbackAuthMiddleware({
        env: buildEnv({ EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS: "0" }),
        cache,
    });

    const expiredPayload = buildPayload({ exp: nowSeconds() - 60 });
    const token = await signJwt(expiredPayload, privateKey, { kid });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("rejects JWT with issuer mismatch", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-iss";
    const publicJwk = await exportJwk(publicKey, kid);

    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ keys: [publicJwk] }),
    });
    const cache = new JwksCache({ fetchImpl });

    const middleware = createCallbackAuthMiddleware({ env: buildEnv(), cache });

    const wrongIssuerPayload = buildPayload({ iss: "http://wrong-issuer.test/realms/other" });
    const token = await signJwt(wrongIssuerPayload, privateKey, { kid });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("rejects JWT with audience mismatch", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-aud";
    const publicJwk = await exportJwk(publicKey, kid);

    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ keys: [publicJwk] }),
    });
    const cache = new JwksCache({ fetchImpl });

    const middleware = createCallbackAuthMiddleware({ env: buildEnv(), cache });

    const wrongAudPayload = buildPayload({ aud: "some-other-service" });
    const token = await signJwt(wrongAudPayload, privateKey, { kid });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("rejects JWT with unknown kid (no matching JWKS key)", async () => {
    const { privateKey } = await generateRsaKeyPair();
    const { publicKey: differentPublicKey } = await generateRsaKeyPair();
    const kid = "known-key";
    const differentJwk = await exportJwk(differentPublicKey, "different-key");

    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ keys: [differentJwk] }),
    });
    const cache = new JwksCache({ fetchImpl });

    const middleware = createCallbackAuthMiddleware({ env: buildEnv(), cache });

    const token = await signJwt(buildPayload(), privateKey, { kid });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("rejects JWT signed with wrong private key", async () => {
    const { publicKey } = await generateRsaKeyPair();
    const { privateKey: wrongPrivateKey } = await generateRsaKeyPair();
    const kid = "key-sig";
    const publicJwk = await exportJwk(publicKey, kid);

    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ keys: [publicJwk] }),
    });
    const cache = new JwksCache({ fetchImpl });

    const middleware = createCallbackAuthMiddleware({ env: buildEnv(), cache });

    const token = await signJwt(buildPayload(), wrongPrivateKey, { kid });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("passes through unauthenticated when auth is disabled", async () => {
    const middleware = createCallbackAuthMiddleware({
        env: buildEnv({ EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED: "false" }),
        cache: new JwksCache(),
    });
    const req = mockRequest({});
    req.externalServiceAuth = undefined;
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.externalServiceAuth?.disabled, true);
});

test("rejects a callback with 503 not_configured when no connection is stored", async () => {
    const jwksRequests = [];
    const middleware = createCallbackAuthMiddleware({
        env:           buildEnv(),
        getConnection: async () => null,
        cache:         new JwksCache({
            fetchImpl: async (url) => { jwksRequests.push(url); throw new Error("no request expected"); },
        }),
    });
    const req = mockRequest({ authorization: "Bearer some.token.here" });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "not_configured");
    assert.equal(nextCalled, false);
    assert.deepEqual(jwksRequests, []);
});

test("returns 500 when the connection cannot be read", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const middleware = createCallbackAuthMiddleware({
            env:           buildEnv(),
            getConnection: async () => { throw new Error("database down"); },
            cache:         new JwksCache(),
        });
        const res = mockResponse();
        let nextCalled = false;

        await middleware(mockRequest({ authorization: "Bearer some.token.here" }), res, () => {
            nextCalled = true;
        });

        assert.equal(res.statusCode, 500);
        assert.equal(nextCalled, false);
    } finally {
        console.error = originalError;
    }
});

test("fetches the JWKS through base_url and checks the public issuer", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-derived";
    const publicJwk = await exportJwk(publicKey, kid);
    const jwksRequests = [];
    const cache = new JwksCache({
        fetchImpl: async (url) => {
            jwksRequests.push(url);
            return { ok: true, json: async () => ({ keys: [publicJwk] }) };
        },
    });
    const middleware = createCallbackAuthMiddleware({ env: buildEnv(), cache });

    const accepted = mockRequest({
        authorization: `Bearer ${await signJwt(buildPayload(), privateKey, { kid })}`,
    });
    let nextCalled = false;
    await middleware(accepted, mockResponse(), () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.deepEqual(jwksRequests, [TEST_JWKS_URL]);

    // A token whose issuer is the internal URL is not the one AI Additions publishes.
    const internalIssuer = "http://ai-additions.internal:8010/keycloak/realms/ethicapp-ai-additions";
    const rejected = mockRequest({
        authorization: `Bearer ${await signJwt(buildPayload({ iss: internalIssuer }), privateKey, { kid })}`,
    });
    const res = mockResponse();
    await middleware(rejected, res, () => assert.fail("must not accept the internal issuer"));
    assert.equal(res.statusCode, 401);
});

test("without keycloak_public_url the issuer is base_url/keycloak", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-default-issuer";
    const publicJwk = await exportJwk(publicKey, kid);
    const cache = new JwksCache({
        fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [publicJwk] }) }),
    });
    const middleware = createCallbackAuthMiddleware({
        env:           buildEnv(),
        getConnection: async () => ({ baseUrl: "https://ai.example.org/", keycloakPublicUrl: null }),
        cache,
    });
    const iss = "https://ai.example.org/keycloak/realms/ethicapp-ai-additions";
    const req = mockRequest({
        authorization: `Bearer ${await signJwt(buildPayload({ iss }), privateKey, { kid })}`,
    });
    let nextCalled = false;

    await middleware(req, mockResponse(), () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.externalServiceAuth?.iss, iss);
});

test("drops cached JWKS keys when the connection moves to another host", async () => {
    const { privateKey, publicKey } = await generateRsaKeyPair();
    const kid = "key-moved";
    const publicJwk = await exportJwk(publicKey, kid);
    const jwksRequests = [];
    const cache = new JwksCache({
        fetchImpl: async (url) => {
            jwksRequests.push(url);
            return { ok: true, json: async () => ({ keys: [publicJwk] }) };
        },
    });
    let connection = { baseUrl: "http://first.internal", keycloakPublicUrl: "https://ai.example.org/keycloak" };
    const middleware = createCallbackAuthMiddleware({
        env:           buildEnv(),
        getConnection: async () => connection,
        cache,
    });
    const token = await signJwt(buildPayload(), privateKey, { kid });

    await middleware(mockRequest({ authorization: `Bearer ${token}` }), mockResponse(), () => {});
    connection = { baseUrl: "http://second.internal", keycloakPublicUrl: "https://ai.example.org/keycloak" };
    await middleware(mockRequest({ authorization: `Bearer ${token}` }), mockResponse(), () => {});

    assert.deepEqual(jwksRequests, [
        "http://first.internal/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/certs",
        "http://second.internal/keycloak/realms/ethicapp-ai-additions/protocol/openid-connect/certs",
    ]);
});
