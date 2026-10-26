import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    deriveAiAdditionsEndpoints,
    isUsableAiAdditionsConnection,
    isValidAiAdditionsUrl,
} from "../ai-additions-connection.js";

// The one AI Additions connection URL rule (#834). The management console
// passes the same cases (it keeps a byte-identical copy of this file). In the
// Docker test stage the file is copied to /canonical-schemas.
const URL_CASES_URL = new URL(
    "../../../../canonical-schemas/ai-additions-connection/url-cases.json", import.meta.url
);
const { cases: URL_CASES } = JSON.parse(readFileSync(URL_CASES_URL, "utf8"));
const VALID_CASES = URL_CASES.filter(({ valid }) => valid);
const INVALID_CASES = URL_CASES.filter(({ valid }) => !valid);

test("the shared URL cases cover both outcomes", () => {
    assert.ok(VALID_CASES.length > 0);
    assert.ok(INVALID_CASES.length > 0);
});

for (const { name, url, valid, reason } of URL_CASES) {
    test(`isValidAiAdditionsUrl: ${valid ? "accepts" : "rejects"} ${name}`, () => {
        assert.equal(isValidAiAdditionsUrl(url), valid, `${JSON.stringify(url)}: ${reason}`);
    });
}

test("isValidAiAdditionsUrl: rejects undefined", () => {
    assert.equal(isValidAiAdditionsUrl(undefined), false);
});

test("deriveAiAdditionsEndpoints: the base URL is the console's stored form", () => {
    for (const { url, normalized } of VALID_CASES) {
        assert.equal(deriveAiAdditionsEndpoints({ baseUrl: url }).baseUrl, normalized, url);
    }
});

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

for (const { name, url } of INVALID_CASES) {
    if (url === "" || url === null) {
        continue;
    }

    test(`deriveAiAdditionsEndpoints: not_configured for a base_url with ${name}`, () => {
        assert.throws(() => deriveAiAdditionsEndpoints({ baseUrl: url }), { code: "not_configured" });
    });

    test(`deriveAiAdditionsEndpoints: not_configured for a keycloak_public_url with ${name}`, () => {
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
