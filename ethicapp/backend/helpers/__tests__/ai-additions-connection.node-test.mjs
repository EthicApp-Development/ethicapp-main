import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveAiAdditionsEndpoints,
    isUsableAiAdditionsConnection,
    isValidAiAdditionsUrl,
} from "../ai-additions-connection.js";

// Stored connection URLs (#815 refinement): the rule of the management
// console, `^https?://[^/?#\s]+` on the raw value, with no query string,
// fragment or userinfo. Path prefixes are allowed.

const VALID_URLS = [
    "http://ai-additions",
    "http://ai-additions:8080",
    "https://ai.example.org",
    "https://ai.example.org/",
    "https://ai.example.org/ai-additions",
    "https://ai.example.org/keycloak/",
    "HTTPS://AI.EXAMPLE.ORG",
    "http://10.0.0.5:3000/prefix",
    "http://[::1]:8080",
];

const INVALID_URLS = {
    "a query string":          "https://ai.example.org?tenant=1",
    "a query after a path":    "https://ai.example.org/keycloak?x=1",
    "an empty query":          "https://ai.example.org/?",
    "a fragment":              "https://ai.example.org#section",
    "a fragment after a path": "https://ai.example.org/path#x",
    "userinfo":                "https://user:secret@ai.example.org",
    "a user name":             "https://user@ai.example.org",
    "an empty userinfo":       "https://@ai.example.org",
    "no authority":            "https:///ai-additions",
    "a scheme only":           "https://",
    "a single slash":          "https:/ai.example.org",
    "no scheme":               "ai.example.org",
    "another scheme":          "ftp://ai.example.org",
    "a leading space":         " https://ai.example.org",
    "a trailing space":        "https://ai.example.org ",
    "an inner space":          "https://ai.example.org/a b",
    "an empty string":         "",
    "a non-string":            42,
    "null":                    null,
};

test("isValidAiAdditionsUrl: accepts http(s) URLs with an authority and a path prefix", () => {
    for (const url of VALID_URLS) {
        assert.equal(isValidAiAdditionsUrl(url), true, url);
    }
});

for (const [label, url] of Object.entries(INVALID_URLS)) {
    test(`isValidAiAdditionsUrl: rejects ${label}`, () => {
        assert.equal(isValidAiAdditionsUrl(url), false, String(url));
    });
}

test("isUsableAiAdditionsConnection: checks base_url and, when set, keycloak_public_url", () => {
    assert.equal(isUsableAiAdditionsConnection(null), false);
    assert.equal(isUsableAiAdditionsConnection({ baseUrl: "https://ai.example.org" }), true);
    for (const keycloakPublicUrl of [null, undefined, ""]) {
        assert.equal(isUsableAiAdditionsConnection({
            baseUrl: "https://ai.example.org", keycloakPublicUrl,
        }), true, String(keycloakPublicUrl));
    }
    assert.equal(isUsableAiAdditionsConnection({
        baseUrl: "https://ai.example.org", keycloakPublicUrl: "https://auth.example.org/keycloak",
    }), true);
});

for (const [label, url] of Object.entries(INVALID_URLS)) {
    if (url === "" || url === null) {
        continue;
    }

    test(`deriveAiAdditionsEndpoints: not_configured for a base_url with ${label}`, () => {
        assert.throws(() => deriveAiAdditionsEndpoints({ baseUrl: url }), { code: "not_configured" });
    });

    test(`deriveAiAdditionsEndpoints: not_configured for a keycloak_public_url with ${label}`, () => {
        assert.throws(
            () => deriveAiAdditionsEndpoints({ baseUrl: "https://ai.example.org", keycloakPublicUrl: url }),
            { code: "not_configured" }
        );
    });
}

test("deriveAiAdditionsEndpoints: a valid connection with a path prefix derives every URL", () => {
    const endpoints = deriveAiAdditionsEndpoints({
        baseUrl:           "https://ai.example.org/prefix/",
        keycloakPublicUrl: "https://auth.example.org/keycloak/",
    }, { realm: "realm" });

    assert.equal(endpoints.baseUrl, "https://ai.example.org/prefix");
    assert.equal(endpoints.tokenUrl,
        "https://ai.example.org/prefix/keycloak/realms/realm/protocol/openid-connect/token");
    assert.equal(endpoints.issuer, "https://auth.example.org/keycloak/realms/realm");
});
