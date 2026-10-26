import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { AiAdditionsNotConfiguredError } from "../../helpers/ai-additions-connection.js";
import {
    acceptLanguageFor,
    adaptersByRequiredService,
    classifyAiAdditionsError,
    createAiServicesCatalogService,
    isValidConnectionUrl,
    normalizeCatalogLocale,
    parseCatalogResponse,
} from "../ai-services-catalog.service.js";

const manifest = JSON.parse(
    await fs.readFile(new URL("../../external-services/manifest.json", import.meta.url), "utf8")
);

test("locales follow the canonical rule: Spanish only when asked for", () => {
    for (const value of ["es", "es_CL", "es-AR", "ES-cl,en;q=0.5"]) {
        assert.equal(normalizeCatalogLocale(value), "es_CL", value);
        assert.equal(acceptLanguageFor(value), "es-CL", value);
    }
    for (const value of [undefined, null, "", "en_US", "pt-BR", "esperanto"]) {
        assert.equal(normalizeCatalogLocale(value), "en_US", String(value));
        assert.equal(acceptLanguageFor(value), "en-US", String(value));
    }
});

test("connection URLs need http(s), an explicit authority and no query, fragment or userinfo", () => {
    for (const value of [
        "http://ethicapp-ai-additions:8010",
        "https://ai.example.org/",
        "https://ai.example.org/prefix/path",
        "  https://ai.example.org  ",
    ]) {
        assert.equal(isValidConnectionUrl(value), true, value);
    }
    for (const value of [
        undefined, null, 1, "", "ai.example.org", "file:///etc/passwd", "http:ai.example.org",
        "http:///ai.example.org", "http://user@ai.example.org", "http://ai.example.org?x",
        "http://ai.example.org/#x", "http://ai.example.org/./x", "http://ai.example.org\\x",
        "http://ai example.org", `https://ai.example.org/${"a".repeat(2048)}`,
    ]) {
        assert.equal(isValidConnectionUrl(value), false, String(value));
    }
});

test("the catalog response keeps the contract fields EthicApp uses", () => {
    const parsed = parseCatalogResponse({
        contractVersion: "1",
        extra:           true,
        services:        [{
            id:             "polyadic-agent",
            name:           "Polyadic",
            description:    "Agents",
            usesLlm:        true,
            descriptorPath: "/polyadic-agent/api/capabilities",
            apiBasePath:    "/polyadic-agent/api",
            status:         "available",
            future:         "ignored",
        }],
    });

    assert.deepEqual(parsed, {
        contractVersion: "1",
        services:        [{
            id:          "polyadic-agent",
            name:        "Polyadic",
            description: "Agents",
            usesLlm:     true,
            status:      "available",
        }],
    });
    assert.deepEqual(parseCatalogResponse({ contractVersion: "1", services: [] }).services, []);
});

test("a catalog response outside the contract is invalid_response", () => {
    const service = {
        id:             "polyadic-agent",
        name:           "Polyadic",
        description:    "Agents",
        usesLlm:        true,
        descriptorPath: "/polyadic-agent/api/capabilities",
        apiBasePath:    "/polyadic-agent/api",
        status:         "available",
    };
    for (const body of [
        null,
        [],
        "text",
        { services: [] },
        { contractVersion: 1, services: [] },
        { contractVersion: "1", services: {} },
        { contractVersion: "1", services: [null] },
        { contractVersion: "1", services: [{ ...service, id: "Not An Id" }] },
        { contractVersion: "1", services: [{ ...service, usesLlm: "yes" }] },
        { contractVersion: "1", services: [{ ...service, name: "" }] },
        { contractVersion: "1", services: [{ ...service, apiBasePath: undefined }] },
        { contractVersion: "1", services: [service, service] },
    ]) {
        assert.throws(
            () => parseCatalogResponse(body),
            error => classifyAiAdditionsError(error) === "invalid_response",
            JSON.stringify(body)
        );
    }
});

test("errors map to the four codes", () => {
    const withStatus = statusCode => Object.assign(new Error("HTTP"), { statusCode });
    const cases = [
        [new AiAdditionsNotConfiguredError(), "not_configured"],
        [withStatus(401), "unauthorized"],
        [withStatus(403), "unauthorized"],
        [withStatus(502), "unreachable"],
        [withStatus(503), "unreachable"],
        [withStatus(504), "unreachable"],
        [withStatus(404), "invalid_response"],
        [withStatus(500), "invalid_response"],
        [new TypeError("fetch failed"), "unreachable"],
        [Object.assign(new Error("aborted"), { name: "AbortError" }), "unreachable"],
        [Object.assign(new Error("dns"), { code: "ENOTFOUND" }), "unreachable"],
        [Object.assign(new Error("wrapped"), { cause: { code: "ECONNREFUSED" } }), "unreachable"],
        [new Error("AI Additions Keycloak token endpoint did not return access_token."), "invalid_response"],
    ];
    for (const [error, code] of cases) {
        assert.equal(classifyAiAdditionsError(error), code, `${error.name} ${error.statusCode ?? ""}`);
    }
});

test("each AI Additions service lists the shipped adapters that require it, without development ones", () => {
    const adapters = adaptersByRequiredService(manifest);
    const ids = serviceId => (adapters.get(serviceId) ?? []).map(adapter => adapter.id);

    assert.deepEqual(ids("polyadic-agent"), ["polyadic-devils-advocate"]);
    assert.deepEqual(ids("argumentation-tutor"), ["argumentation-tutor-system"]);
    assert.deepEqual(ids("case-analyst"), ["case-analyst"]);
    for (const list of adapters.values()) {
        for (const adapter of list) {
            assert.equal(adapter.id.startsWith("mock-"), false);
            assert.equal(typeof adapter.description, "string");
        }
    }
});

test("the default adapter catalog is the shipped manifest", async () => {
    const client = {
        getEndpoints:            async () => ({ baseUrl: "http://ai.local" }),
        getKeycloakClientId:     () => "id",
        getKeycloakClientSecret: () => "secret",
        requestJson:             async () => ({
            contractVersion: "1",
            services:        [{
                id:             "polyadic-agent",
                name:           "Polyadic",
                description:    "Agents",
                usesLlm:        true,
                descriptorPath: "/polyadic-agent/api/capabilities",
                apiBasePath:    "/polyadic-agent/api",
                status:         "available",
            }],
        }),
    };
    const service = createAiServicesCatalogService({ client, logger: { warn() {} } });

    const result = await service.readCatalog({ locale: "en_US" });

    assert.equal(result.ok, true);
    assert.deepEqual(result.services[0].adapters.map(adapter => adapter.id), ["polyadic-devils-advocate"]);
});
