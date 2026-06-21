import assert from "node:assert/strict";
import test from "node:test";
import { createCallbackAuthMiddleware } from "../external-services-callback-auth.middleware.js";
import { JwksCache } from "../../helpers/keycloak-jwt.helper.js";

const TEST_ISSUER = "http://keycloak.test/realms/ethicapp-ai-additions";
const TEST_AUDIENCE = "ethicapp-main";
const TEST_JWKS_URL = `${TEST_ISSUER}/protocol/openid-connect/certs`;

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
        EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER: TEST_ISSUER,
        EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL: TEST_JWKS_URL,
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
    assert.equal(req.externalServiceAuth, null);
});

test("returns 500 when JWKS URL is not configured", async () => {
    const middleware = createCallbackAuthMiddleware({
        env: {
            EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED: "true",
        },
        cache: new JwksCache(),
    });
    const req = mockRequest({ authorization: "Bearer some.token.here" });
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 500);
    assert.equal(nextCalled, false);
});
