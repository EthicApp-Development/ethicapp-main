import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AiAdditionsClient } from "../ai-additions-client.service.js";
import {
    CapabilityDescriptorsClient,
    descriptorLocale,
    normalizeDescriptor,
} from "../capability-descriptors.service.js";

const LINK = Object.freeze({ serviceId: "polyadic-agent", path: "/polyadic-agent/api/capabilities" });

function makeDescriptor(overrides = {}) {
    return {
        contract_version:       "1",
        service:                { id: "polyadic-agent", name: "Polyadic Agent", uses_llm: true },
        instance_configuration: {
            fields: [
                {
                    key:        "agent_role",
                    type:       "enum",
                    required:   true,
                    default:    "devils_advocate",
                    display:    { label: "Agent role", description: "How the agent takes part.", group: "behavior", order: 1 },
                    validation: {
                        enum: [
                            { value: "devils_advocate", label: "Devil's advocate" },
                            { value: "moderator", label: "Moderator", status: "deprecated", superseded_by: "devils_advocate" },
                        ],
                    },
                },
                {
                    key:        "max_interventions",
                    type:       "integer",
                    required:   false,
                    default:    3,
                    display:    { label: "Maximum interventions", order: 2 },
                    validation: { minimum: 0, maximum: 10, step: 1 },
                },
                {
                    key:        "instructions",
                    type:       "text",
                    required:   false,
                    default:    "",
                    display:    { label: "Extra instructions" },
                    validation: { max_length: 500, multiline: true },
                },
            ],
        },
        runtime_configuration: {
            fields: [
                {
                    key:        "room_id",
                    type:       "text",
                    required:   true,
                    default:    null,
                    display:    { label: "Room" },
                    validation: {},
                },
            ],
        },
        ...overrides,
    };
}

function makeLogger() {
    const warnings = [];
    return { warnings, warn: message => warnings.push(message) };
}

function makeClient({ responses = [], link = LINK, ...options } = {}) {
    const requests = [];
    const queue = [...responses];
    const logger = makeLogger();
    let clock = 0;
    const client = new CapabilityDescriptorsClient({
        getDescriptorLink: serviceId => (serviceId === "svc-described" ? link : null),
        requestJson:       async (path, requestOptions) => {
            requests.push({ path, ...requestOptions });
            const next = queue.length > 1 ? queue.shift() : queue[0];
            if (next instanceof Error) {
                throw next;
            }
            return typeof next === "function" ? next() : structuredClone(next);
        },
        now:       () => clock,
        ttlMs:     1000,
        retryMs:   100,
        timeoutMs: 2500,
        logger,
        ...options,
    });

    return {
        client,
        requests,
        logger,
        advance: ms => { clock += ms; },
    };
}

function httpError(statusCode) {
    const error = new Error(`HTTP ${statusCode}`);
    error.statusCode = statusCode;
    return error;
}

// ─── descriptorLocale ─────────────────────────────────────────────────────────

test("descriptorLocale: Spanish only for Spanish locales", () => {
    for (const locale of ["es", "es_CL", "es-AR", "ES_es"]) {
        assert.equal(descriptorLocale(locale), "es-CL", locale);
    }
    for (const locale of ["en_US", "pt_BR", "estonian", "", null, undefined]) {
        assert.equal(descriptorLocale(locale), "en-US", String(locale));
    }
});

// ─── normalizeDescriptor ──────────────────────────────────────────────────────

test("normalizeDescriptor: normalizes a valid descriptor", () => {
    const result = normalizeDescriptor(makeDescriptor(), "polyadic-agent");

    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.descriptor.serviceId, "polyadic-agent");
    assert.equal(result.descriptor.name, "Polyadic Agent");
    assert.equal(result.descriptor.usesLlm, true);
    assert.deepEqual(result.descriptor.fields.map(field => field.key),
        ["agent_role", "max_interventions", "instructions"]);
    assert.deepEqual(result.descriptor.fields[1], {
        key:          "max_interventions",
        type:         "integer",
        required:     false,
        default:      3,
        label:        "Maximum interventions",
        description:  null,
        group:        null,
        order:        2,
        status:       "active",
        supersededBy: null,
        validation:   { minimum: 0, maximum: 10, step: 1 },
    });
    assert.deepEqual(result.descriptor.fields[2].validation,
        { maxLength: 500, pattern: null, multiline: true });
});

test("normalizeDescriptor: never exposes the runtime configuration", () => {
    const result = normalizeDescriptor(makeDescriptor(), "polyadic-agent");

    assert.equal(JSON.stringify(result).includes("room_id"), false);
});

test("normalizeDescriptor: ignores unknown keys at every level", () => {
    const raw = makeDescriptor({ experimental: { anything: true } });
    raw.service.vendor = "ai-additions";
    raw.instance_configuration.layout = "tabs";
    raw.instance_configuration.fields[1].x_hint = "slider";
    raw.instance_configuration.fields[1].display.icon = "counter";
    raw.instance_configuration.fields[1].validation.unit = "turns";
    raw.instance_configuration.fields[0].validation.enum[0].color = "red";

    const result = normalizeDescriptor(raw, "polyadic-agent");
    const baseline = normalizeDescriptor(makeDescriptor(), "polyadic-agent");

    assert.equal(result.ok, true);
    assert.deepEqual(result, baseline);
});

test("normalizeDescriptor: rejects a contract version other than \"1\"", () => {
    for (const version of ["2", 1, undefined]) {
        assert.deepEqual(
            normalizeDescriptor(makeDescriptor({ contract_version: version }), "polyadic-agent"),
            { ok: false, reason: "unsupported_contract_version" },
            String(version)
        );
    }
});

test("normalizeDescriptor: rejects a service id that does not match the manifest", () => {
    assert.deepEqual(
        normalizeDescriptor(makeDescriptor(), "argumentation-tutor"),
        { ok: false, reason: "service_id_mismatch" }
    );
});

test("normalizeDescriptor: rejects a descriptor without the required blocks", () => {
    const cases = [
        null,
        [],
        makeDescriptor({ service: { id: "polyadic-agent", name: "Polyadic Agent" } }),
        makeDescriptor({ instance_configuration: {} }),
        makeDescriptor({ runtime_configuration: undefined }),
    ];

    for (const raw of cases) {
        assert.deepEqual(normalizeDescriptor(raw, "polyadic-agent"),
            { ok: false, reason: "invalid_descriptor" });
    }
});

test("normalizeDescriptor: accepts empty field lists", () => {
    const raw = makeDescriptor({
        instance_configuration: { fields: [] },
        runtime_configuration:  { fields: [] },
    });

    const result = normalizeDescriptor(raw, "polyadic-agent");

    assert.equal(result.ok, true);
    assert.deepEqual(result.descriptor.fields, []);
    assert.deepEqual(result.warnings, []);
});

test("normalizeDescriptor: keeps deprecated fields and enum entries with their replacements", () => {
    const raw = makeDescriptor();
    raw.instance_configuration.fields[1].status = "deprecated";
    raw.instance_configuration.fields[1].superseded_by = "agent_role";

    const { descriptor } = normalizeDescriptor(raw, "polyadic-agent");
    const [role, interventions] = descriptor.fields;

    assert.equal(interventions.status, "deprecated");
    assert.equal(interventions.supersededBy, "agent_role");
    assert.equal(role.status, "active");
    assert.deepEqual(role.validation.entries, [
        { value: "devils_advocate", label: "Devil's advocate", status: "active", supersededBy: null },
        { value: "moderator", label: "Moderator", status: "deprecated", supersededBy: "devils_advocate" },
    ]);
});

test("normalizeDescriptor: drops unusable and repeated fields with warnings", () => {
    const raw = makeDescriptor();
    const fields = raw.instance_configuration.fields;
    fields.push(
        { ...fields[1] },
        { key: "mode", type: "slider", required: false, default: 1, display: { label: "Mode" }, validation: {} },
        { key: "flag", type: "boolean", required: false, display: { label: "Flag" }, validation: {} },
        { key: "tone", type: "enum", required: false, default: "a", display: { label: "Tone" }, validation: { enum: [] } },
        { type: "text", required: false, default: "", display: { label: "No key" }, validation: {} },
        "not-a-field"
    );

    const result = normalizeDescriptor(raw, "polyadic-agent");

    assert.equal(result.ok, true);
    assert.deepEqual(result.descriptor.fields.map(field => field.key),
        ["agent_role", "max_interventions", "instructions"]);
    assert.deepEqual(result.warnings, [
        "field \"max_interventions\" is repeated",
        "field \"mode\" has unsupported type \"slider\"",
        "field \"flag\" lacks required or default",
        "field \"tone\" is an enum without valid entries",
        "field #7 has no key",
        "field #8 is not an object",
    ]);
});

// ─── CapabilityDescriptorsClient ─────────────────────────────────────────────

test("getInstanceConfiguration: null when the service declares no descriptor", async () => {
    const { client, requests } = makeClient({ responses: [makeDescriptor()] });

    assert.equal(await client.getInstanceConfiguration("svc-plain", "en_US"), null);
    assert.equal(requests.length, 0);
});

test("getInstanceConfiguration: fetches the descriptor route with Accept-Language and a timeout", async () => {
    const { client, requests } = makeClient({ responses: [makeDescriptor()] });

    const configuration = await client.getInstanceConfiguration("svc-described", "es_CL");

    assert.equal(configuration.available, true);
    assert.equal(configuration.stale, false);
    assert.equal(configuration.descriptorServiceId, "polyadic-agent");
    assert.equal(configuration.name, "Polyadic Agent");
    assert.equal(configuration.usesLlm, true);
    assert.equal(configuration.locale, "es-CL");
    assert.equal(configuration.fields.length, 3);
    assert.deepEqual(requests, [{
        path:      "/polyadic-agent/api/capabilities",
        headers:   { "Accept-Language": "es-CL" },
        timeoutMs: 2500,
    }]);
});

test("getInstanceConfiguration: the locale is part of the cache key", async () => {
    const { client, requests } = makeClient({ responses: [makeDescriptor()] });

    await client.getInstanceConfiguration("svc-described", "es_CL");
    await client.getInstanceConfiguration("svc-described", "es");
    await client.getInstanceConfiguration("svc-described", "en_US");
    await client.getInstanceConfiguration("svc-described", "pt_BR");

    assert.deepEqual(requests.map(request => request.headers["Accept-Language"]),
        ["es-CL", "en-US"]);
});

test("getInstanceConfiguration: serves cache hits until the TTL expires", async () => {
    const { client, requests, advance } = makeClient({ responses: [makeDescriptor()] });

    const first = await client.getInstanceConfiguration("svc-described", "en_US");
    advance(999);
    const second = await client.getInstanceConfiguration("svc-described", "en_US");
    assert.equal(requests.length, 1);
    assert.equal(second, first);

    advance(1);
    await client.getInstanceConfiguration("svc-described", "en_US");
    assert.equal(requests.length, 2);
});

test("getInstanceConfiguration: concurrent calls share one request", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { client, requests } = makeClient({
        responses: [async () => { await gate; return makeDescriptor(); }],
    });

    const pending = [
        client.getInstanceConfiguration("svc-described", "en_US"),
        client.getInstanceConfiguration("svc-described", "en_US"),
    ];
    release();
    const [first, second] = await Promise.all(pending);

    assert.equal(requests.length, 1);
    assert.equal(first, second);
});

test("getInstanceConfiguration: an unreachable service is reported, not thrown, and retried later", async () => {
    const { client, requests, logger, advance } = makeClient({
        responses: [httpError(503), makeDescriptor()],
    });

    assert.deepEqual(await client.getInstanceConfiguration("svc-described", "en_US"),
        { available: false, reason: "unreachable" });
    assert.match(logger.warnings[0], /svc-described: descriptor unavailable \(HTTP 503\)$/u);

    advance(99);
    await client.getInstanceConfiguration("svc-described", "en_US");
    assert.equal(requests.length, 1, "the failure is cached for the retry delay");

    advance(1);
    const recovered = await client.getInstanceConfiguration("svc-described", "en_US");
    assert.equal(requests.length, 2);
    assert.equal(recovered.available, true);
});

test("getInstanceConfiguration: an invalid descriptor is reported with its reason", async () => {
    const { client, logger } = makeClient({ responses: [makeDescriptor({ contract_version: "2" })] });

    assert.deepEqual(await client.getInstanceConfiguration("svc-described", "en_US"),
        { available: false, reason: "unsupported_contract_version" });
    assert.match(logger.warnings[0], /svc-described: unsupported_contract_version/u);
});

test("getInstanceConfiguration: keeps the last good descriptor, marked stale, after a failure", async () => {
    const { client, requests, advance } = makeClient({
        responses: [makeDescriptor(), httpError(502), makeDescriptor()],
    });

    const fresh = await client.getInstanceConfiguration("svc-described", "en_US");
    advance(1000);
    const stale = await client.getInstanceConfiguration("svc-described", "en_US");

    assert.equal(stale.available, true);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.fields, fresh.fields);

    advance(100);
    const refreshed = await client.getInstanceConfiguration("svc-described", "en_US");
    assert.equal(requests.length, 3);
    assert.equal(refreshed.stale, false);
});

test("getInstanceConfiguration: logs dropped fields once per fetch", async () => {
    const raw = makeDescriptor();
    raw.instance_configuration.fields.push({ key: "broken" });
    const { client, logger } = makeClient({ responses: [raw] });

    await client.getInstanceConfiguration("svc-described", "en_US");
    await client.getInstanceConfiguration("svc-described", "en_US");

    assert.deepEqual(logger.warnings,
        ["[capability-descriptors] svc-described: field \"broken\" has unsupported type \"undefined\"; ignored."]);
});

// ─── Through AiAdditionsClient (timeout and 401 retry) ───────────────────────

function jsonResponse(body, status = 200) {
    return {
        ok:   status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    };
}

function makeAiAdditionsClient(fetchImpl, extra = {}) {
    return new AiAdditionsClient({
        env: {
            AI_ADDITIONS_KEYCLOAK_CLIENT_ID:     "ethicapp-platform",
            AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "secret",
        },
        getConnection:   async () => ({ baseUrl: "http://ai.local", keycloakPublicUrl: null }),
        connectionTtlMs: 0,
        fetchImpl,
        ...extra,
    });
}

// Wired like the registry does (services/external-services.service.js).
function clientOver(aiAdditionsClient, extra = {}) {
    return new CapabilityDescriptorsClient({
        getDescriptorLink: () => LINK,
        requestJson:       (path, options) => aiAdditionsClient.requestJson(path, options),
        getConnectionKey:  () => aiAdditionsClient.getConnectionFingerprint(),
        timeoutMs:         2500,
        logger:            makeLogger(),
        ...extra,
    });
}

test("through AiAdditionsClient: without a connection the descriptor is unavailable and nothing is requested", async () => {
    const aiAdditions = makeAiAdditionsClient(async (url) => {
        throw new Error(`no request may leave the host, got ${url}`);
    }, { getConnection: async () => null });

    const configuration = await clientOver(aiAdditions).getInstanceConfiguration("svc", "en_US");

    assert.deepEqual(configuration, { available: false, reason: "not_configured" });
});

test("through AiAdditionsClient: a changed or removed connection drops cached descriptors", async () => {
    let connection = { baseUrl: "http://first.local" };
    const serviceCalls = [];
    const aiAdditions = makeAiAdditionsClient(async (url) => {
        if (url.includes("/protocol/openid-connect/token")) {
            return jsonResponse({ access_token: "token", expires_in: 300 });
        }
        serviceCalls.push(url);
        return jsonResponse(makeDescriptor());
    }, { getConnection: async () => connection });
    const descriptors = clientOver(aiAdditions);

    assert.equal((await descriptors.getInstanceConfiguration("svc", "en_US")).available, true);
    assert.equal((await descriptors.getInstanceConfiguration("svc", "en_US")).available, true);
    assert.deepEqual(serviceCalls, ["http://first.local/polyadic-agent/api/capabilities"]);

    connection = { baseUrl: "http://second.local" };
    assert.equal((await descriptors.getInstanceConfiguration("svc", "en_US")).available, true);
    assert.deepEqual(serviceCalls, [
        "http://first.local/polyadic-agent/api/capabilities",
        "http://second.local/polyadic-agent/api/capabilities",
    ]);

    connection = null;
    assert.deepEqual(await descriptors.getInstanceConfiguration("svc", "en_US"),
        { available: false, reason: "not_configured" }, "no stale descriptor without a connection");

    connection = { baseUrl: "http://second.local" };
    assert.equal((await descriptors.getInstanceConfiguration("svc", "en_US")).available, true);
    assert.equal(serviceCalls.length, 3, "the cache was emptied when the connection was removed");
});

test("an unreadable connection reports the descriptor unreachable", async () => {
    const logger = makeLogger();
    const descriptors = new CapabilityDescriptorsClient({
        getDescriptorLink: () => LINK,
        requestJson:       async () => assert.fail("must not request"),
        getConnectionKey:  async () => { throw new Error("database down"); },
        logger,
    });

    assert.deepEqual(await descriptors.getInstanceConfiguration("svc", "en_US"),
        { available: false, reason: "unreachable" });
    assert.equal(logger.warnings.length, 1);
});

test("through AiAdditionsClient: retries once with a new token after a 401", async () => {
    let tokens = 0;
    const serviceCalls = [];
    const aiAdditions = makeAiAdditionsClient(async (url, options) => {
        if (url.includes("/protocol/openid-connect/token")) {
            tokens += 1;
            return jsonResponse({ access_token: `token-${tokens}`, expires_in: 300 });
        }

        serviceCalls.push({ url, headers: options.headers });
        return serviceCalls.length === 1
            ? jsonResponse({ error: "expired" }, 401)
            : jsonResponse(makeDescriptor());
    });

    const configuration = await clientOver(aiAdditions).getInstanceConfiguration("svc", "es_CL");

    assert.equal(configuration.available, true);
    assert.equal(tokens, 2);
    assert.deepEqual(serviceCalls.map(call => call.headers.Authorization),
        ["Bearer token-1", "Bearer token-2"]);
    assert.equal(serviceCalls[1].url, "http://ai.local/polyadic-agent/api/capabilities");
    assert.equal(serviceCalls[1].headers["Accept-Language"], "es-CL");
});

test("through AiAdditionsClient: a timeout is reported as unreachable", async () => {
    const timeouts = [];
    const aiAdditions = makeAiAdditionsClient(
        async (url, options) => {
            if (url.includes("/protocol/openid-connect/token")) {
                return jsonResponse({ access_token: "token", expires_in: 300 });
            }

            // Never answers: only the abort signal ends the request.
            return new Promise((resolve, reject) => {
                options.signal.addEventListener("abort", () => {
                    reject(new DOMException("This operation was aborted", "AbortError"));
                });
            });
        },
        {
            setTimeoutImpl: (callback, ms) => {
                timeouts.push(ms);
                if (ms === 2500) {
                    queueMicrotask(callback);
                }
                return timeouts.length;
            },
            clearTimeoutImpl: () => {},
        }
    );

    const configuration = await clientOver(aiAdditions).getInstanceConfiguration("svc", "en_US");

    assert.deepEqual(configuration, { available: false, reason: "unreachable" });
    assert.equal(timeouts.at(-1), 2500, "the descriptor timeout reaches fetchJsonRaw");
});

// ─── Storage ──────────────────────────────────────────────────────────────────

test("the module keeps its cache in memory and imports no Redis client", async () => {
    const source = await readFile(new URL("../capability-descriptors.service.js", import.meta.url), "utf8");

    // No imports at all: the cache can only live in the client's own Maps.
    assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/mu);
});
