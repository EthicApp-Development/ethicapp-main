import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDescriptor } from "../capability-descriptors.service.js";
import {
    INVALID_CONFIGURATION_CODE,
    checkServiceConfiguration,
    designEnabledServiceIds,
    invalidConfigurationResponse,
    notAllowedServiceWarnings,
    validateDesignServiceConfigurations,
} from "../service-configuration-validation.service.js";

const SERVICE = "polyadic-devils-advocate";

function field(key, type, validation, extra = {}) {
    return {
        key,
        type,
        required: false,
        default:  null,
        display:  { label: key },
        validation,
        ...extra,
    };
}

// Normalized exactly as the descriptor client (#727) serves it.
const { descriptor } = normalizeDescriptor({
    contract_version:       "1",
    service:                { id: "polyadic-agent", name: "Polyadic Agents", uses_llm: true },
    instance_configuration: {
        fields: [
            field("llm_tier", "enum", {
                enum: [
                    { value: "basic", label: "Basic" },
                    { value: "advanced", label: "Advanced" },
                    {
                        value:         "legacy",
                        label:         "Legacy",
                        status:        "deprecated",
                        superseded_by: "basic",
                    },
                ],
            }),
            field("model", "enum", { enum: [{ value: "gpt-4o-mini", label: "GPT-4o mini" }] }, {
                status:        "deprecated",
                superseded_by: "llm_tier",
            }),
            field("session_duration_seconds", "integer", { minimum: 300, maximum: 7200, step: 60 }),
            field("temperature", "number", { minimum: 0, maximum: 1 }),
            field("anonymous_guide", "boolean", {}),
            field("agent_nickname", "text", {
                max_length: 10,
                pattern:    "^[A-Za-zÁÉÍÓÚáéíóúñÑ ]*$",
            }),
            field("room_label", "text", { max_length: 20 }, { required: true }),
        ],
    },
    runtime_configuration: { fields: [] },
}, "polyadic-agent");

const FIELDS = descriptor.fields;
const AVAILABLE = Object.freeze({ available: true, fields: FIELDS });

function designWith(configuration, { enabled = [SERVICE], serviceId = SERVICE } = {}) {
    return {
        type:   "semantic_differential",
        phases: [{
            mode:             "individual",
            externalServices: {
                enabledServiceIds: enabled,
                configurations:    { [serviceId]: configuration },
            },
        }],
    };
}

function lookup(answer = AVAILABLE) {
    const calls = [];
    const getInstanceConfiguration = async (serviceId, locale) => {
        calls.push({ serviceId, locale });
        return typeof answer === "function" ? answer(serviceId) : answer;
    };
    return { calls, getInstanceConfiguration };
}

const VALID = Object.freeze({
    llm_tier:                 "advanced",
    session_duration_seconds: 900,
    temperature:              0.5,
    anonymous_guide:          false,
    agent_nickname:           "Sofía",
    room_label:               "Sala 1",
});

// ─── checkServiceConfiguration ───────────────────────────────────────────────

test("field check: accepts valid values", () => {
    assert.deepEqual(checkServiceConfiguration({ ...VALID }, FIELDS),
        { problems: [], deprecations: [] });
});

test("field check: null and missing optional values use the service default", () => {
    const { problems } = checkServiceConfiguration({ room_label: "A", llm_tier: null }, FIELDS);

    assert.deepEqual(problems, []);
});

test("field check: reports each kind of field error", () => {
    const cases = [
        [{ llm_tier: "premium" }, "llm_tier", "not_in_enum"],
        [{ llm_tier: 3 }, "llm_tier", "not_in_enum"],
        [{ llm_tier: { value: "basic" } }, "llm_tier", "invalid_type"],
        [{ session_duration_seconds: "900" }, "session_duration_seconds", "invalid_type"],
        [{ session_duration_seconds: 900.5 }, "session_duration_seconds", "invalid_type"],
        [{ session_duration_seconds: 120 }, "session_duration_seconds", "below_minimum"],
        [{ session_duration_seconds: 9000 }, "session_duration_seconds", "above_maximum"],
        [{ session_duration_seconds: 930 }, "session_duration_seconds", "step_mismatch"],
        [{ temperature: Number.NaN }, "temperature", "invalid_type"],
        [{ temperature: 1.5 }, "temperature", "above_maximum"],
        [{ anonymous_guide: "false" }, "anonymous_guide", "invalid_type"],
        [{ agent_nickname: 12 }, "agent_nickname", "invalid_type"],
        [{ agent_nickname: "Sofía la guía" }, "agent_nickname", "too_long"],
        [{ agent_nickname: "Guide #1" }, "agent_nickname", "pattern_mismatch"],
        [{ retired_option: true }, "retired_option", "unknown_field"],
    ];

    for (const [configuration, key, code] of cases) {
        const withRequired = { room_label: "A", ...configuration };
        const { problems } = checkServiceConfiguration(withRequired, FIELDS);
        assert.deepEqual(problems, [{ field: key, code, value: configuration[key] }],
            JSON.stringify(configuration));
    }
});

test("field check: a required field must have a value", () => {
    for (const configuration of [{}, { room_label: null }]) {
        assert.deepEqual(checkServiceConfiguration(configuration, FIELDS).problems,
            [{ field: "room_label", code: "required", value: null }]);
    }
});

test("field check: text length counts characters, not UTF-16 units", () => {
    const { problems } = checkServiceConfiguration({ room_label: "😀".repeat(20) }, FIELDS);

    assert.deepEqual(problems, []);
});

test("field check: an uncompilable pattern is not enforced", () => {
    const fields = FIELDS.map(candidate => (candidate.key === "agent_nickname"
        ? { ...candidate, validation: { ...candidate.validation, pattern: "(?<unclosed" } }
        : candidate));

    const configuration = { room_label: "A", agent_nickname: "x" };
    const { problems } = checkServiceConfiguration(configuration, fields);

    assert.deepEqual(problems, []);
});

test("field check: deprecated fields and values are accepted, reported", () => {
    const result = checkServiceConfiguration({
        room_label: "A",
        model:      "gpt-4o-mini",
        llm_tier:   "legacy",
    }, FIELDS);

    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.deprecations, [
        {
            field:        "model",
            code:         "deprecated_field",
            value:        "gpt-4o-mini",
            supersededBy: "llm_tier",
        },
        { field: "llm_tier", code: "deprecated_value", value: "legacy", supersededBy: "basic" },
    ]);
});

// ─── validateDesignServiceConfigurations ─────────────────────────────────────

test("design check: designs without configurations need no descriptor", async () => {
    const { calls, getInstanceConfiguration } = lookup();
    const designs = [
        { phases: [{ externalServices: { enabledServiceIds: [SERVICE] } }] },
        { phases: [{}] },
        { phases: "not-a-list" },
        {},
    ];

    for (const design of designs) {
        const result = await validateDesignServiceConfigurations({
            design,
            getInstanceConfiguration,
        });
        assert.deepEqual(result,
            { errors: [], warnings: [] });
    }
    assert.equal(calls.length, 0);
});

test("design check: valid configurations pass, read in one locale", async () => {
    const { calls, getInstanceConfiguration } = lookup();

    const result = await validateDesignServiceConfigurations({
        design: designWith({ ...VALID }),
        getInstanceConfiguration,
    });

    assert.deepEqual(result, { errors: [], warnings: [] });
    assert.deepEqual(calls, [{ serviceId: SERVICE, locale: "en_US" }]);
});

test("design check: errors name the phase, service, field and code", async () => {
    const design = designWith({ ...VALID, llm_tier: "premium", extra: 1 });
    design.phases.unshift({ mode: "team" });

    const { errors } = await validateDesignServiceConfigurations({
        design,
        ...lookup(),
    });

    assert.deepEqual(errors, [
        {
            phaseIndex: 1, serviceId:  SERVICE, field:      "llm_tier",
            code:       "not_in_enum", value:      "premium",
        },
        { phaseIndex: 1, serviceId: SERVICE, field: "extra", code: "unknown_field", value: 1 },
    ]);
});

test("design check: configurations of services that are not enabled are skipped", async () => {
    const { calls, getInstanceConfiguration } = lookup();

    const result = await validateDesignServiceConfigurations({
        design: designWith({ llm_tier: "premium" }, { enabled: [] }),
        getInstanceConfiguration,
    });

    assert.deepEqual(result, { errors: [], warnings: [] });
    assert.equal(calls.length, 0);
});

test("design check: deprecated values are accepted with warnings", async () => {
    const result = await validateDesignServiceConfigurations({
        design: designWith({ room_label: "A", model: "gpt-4o-mini" }),
        ...lookup(),
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [{
        phaseIndex:   0,
        serviceId:    SERVICE,
        field:        "model",
        code:         "deprecated_field",
        value:        "gpt-4o-mini",
        supersededBy: "llm_tier",
    }]);
});

test("design check: retired values already stored are accepted with warnings", async () => {
    // "turbo" and "old_flag" were valid when the design was saved; the service
    // has since retired them.
    const stored = designWith({ room_label: "A", llm_tier: "turbo", old_flag: true });
    const edited = designWith({ room_label: "B", llm_tier: "turbo", old_flag: true });

    const result = await validateDesignServiceConfigurations({
        design:       edited,
        storedDesign: stored,
        ...lookup(),
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [
        {
            phaseIndex: 0, serviceId:  SERVICE, field:      "llm_tier",
            code:       "no_longer_accepted", reason:     "not_in_enum", value:      "turbo",
        },
        {
            phaseIndex: 0, serviceId:  SERVICE, field:      "old_flag",
            code:       "no_longer_accepted", reason:     "unknown_field", value:      true,
        },
    ]);
});

test("design check: new problems are errors even next to stored ones", async () => {
    const stored = designWith({ room_label: "A", llm_tier: "turbo" });
    const edited = designWith({ room_label: "A", llm_tier: "hyper" });

    const { errors, warnings } = await validateDesignServiceConfigurations({
        design:       edited,
        storedDesign: stored,
        ...lookup(),
    });

    assert.deepEqual(errors.map(error => [error.field, error.code, error.value]),
        [["llm_tier", "not_in_enum", "hyper"]]);
    assert.deepEqual(warnings, []);
});

test("design check: a newly required field already missing is a warning", async () => {
    const stored = designWith({ llm_tier: "basic" });
    const edited = designWith({ llm_tier: "advanced" });

    const result = await validateDesignServiceConfigurations({
        design:       edited,
        storedDesign: stored,
        ...lookup(),
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings.map(warning => [warning.code, warning.reason, warning.field]),
        [["no_longer_accepted", "required", "room_label"]]);
});

test("design check: an unavailable descriptor accepts the save, warned", async () => {
    const answers = {
        [SERVICE]:         { available: false, reason: "unreachable" },
        "mock-chat-agent": null,
    };
    const design = designWith({ llm_tier: "anything" });
    design.phases[0].externalServices.enabledServiceIds.push("mock-chat-agent");
    design.phases[0].externalServices.configurations["mock-chat-agent"] = { tone: "kind" };

    const result = await validateDesignServiceConfigurations({
        design,
        ...lookup(serviceId => answers[serviceId]),
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [
        {
            phaseIndex: 0, serviceId:  SERVICE, field:      null,
            code:       "not_validated", reason:     "unreachable",
        },
        {
            phaseIndex: 0, serviceId:  "mock-chat-agent", field:      null,
            code:       "not_validated", reason:     "no_descriptor",
        },
    ]);
});

test("design check: each descriptor is requested once per save", async () => {
    const { calls, getInstanceConfiguration } = lookup();
    const design = designWith({ ...VALID });
    design.phases.push(structuredClone(design.phases[0]));

    await validateDesignServiceConfigurations({
        design,
        storedDesign: structuredClone(design),
        getInstanceConfiguration,
    });

    assert.equal(calls.length, 1);
});

test("invalidConfigurationResponse: 400 with the documented body", () => {
    const errors = [{
        phaseIndex: 0, serviceId: SERVICE, field: "x", code: "unknown_field", value: 1,
    }];

    assert.deepEqual(invalidConfigurationResponse({ errors, warnings: [] }), {
        status: 400,
        body:   {
            status:   "err",
            code:     INVALID_CONFIGURATION_CODE,
            message:  "Some external service settings are not valid.",
            errors,
            warnings: [],
        },
    });
});

// ─── services the AI service policy does not allow (#815) ────────────────────

const POLICY_DESIGN = Object.freeze({
    phases: [
        { externalServices: {
            enabledServiceIds: [SERVICE, "mock-chat-agent", SERVICE],
            configurations:    { [SERVICE]: { llm_tier: "nonsense" } },
        } },
        { externalServices: { enabledServiceIds: ["unknown-service"] } },
        {},
    ],
});

test("designEnabledServiceIds: every enabled id once, across phases", () => {
    assert.deepEqual(designEnabledServiceIds(POLICY_DESIGN), [SERVICE, "mock-chat-agent", "unknown-service"]);
    assert.deepEqual(designEnabledServiceIds(null), []);
});

test("notAllowedServiceWarnings: one warning per phase and service that is not usable", () => {
    assert.deepEqual(notAllowedServiceWarnings(POLICY_DESIGN, ["mock-chat-agent"]), [
        { phaseIndex: 0, serviceId: SERVICE, field: null, code: "not_allowed" },
        { phaseIndex: 1, serviceId: "unknown-service", field: null, code: "not_allowed" },
    ]);
});

test("validateDesignServiceConfigurations: a service that is not allowed is a warning, never an error", async () => {
    const asked = [];
    const result = await validateDesignServiceConfigurations({
        design:                   POLICY_DESIGN,
        usableServiceIds:         ["mock-chat-agent"],
        getInstanceConfiguration: async (serviceId) => {
            asked.push(serviceId);
            return { available: true, fields: FIELDS };
        },
    });

    assert.deepEqual(result.errors, [], "its invalid configuration is not validated");
    assert.deepEqual(result.warnings.map(({ serviceId, code }) => ({ serviceId, code })), [
        { serviceId: SERVICE, code: "not_allowed" },
        { serviceId: "unknown-service", code: "not_allowed" },
    ]);
    assert.deepEqual(asked, []);
});

test("validateDesignServiceConfigurations: an allowed service is still validated", async () => {
    const result = await validateDesignServiceConfigurations({
        design:                   POLICY_DESIGN,
        usableServiceIds:         [SERVICE, "mock-chat-agent", "unknown-service"],
        getInstanceConfiguration: async () => ({ available: true, fields: FIELDS }),
    });

    assert.ok(result.errors.some(error => error.field === "llm_tier"));
    assert.ok(result.errors.every(error => error.serviceId === SERVICE));
    assert.deepEqual(result.warnings, []);
});

// ─── The tutor's evaluation_mode (#870) ──────────────────────────────────────

// The tutor's descriptor fields as ethicapp-ai-additions#212 publishes them.
const TUTOR = "argumentation-tutor-system";
const { descriptor: tutorDescriptor } = normalizeDescriptor({
    contract_version:       "1",
    service:                { id: "argumentation-tutor", name: "Argumentation Tutor", uses_llm: true },
    instance_configuration: {
        fields: [
            field("llm_tier", "enum", {
                enum: [{ value: "basic", label: "Basic" }, { value: "advanced", label: "Advanced" }],
            }, { default: "basic" }),
            field("evaluation_mode", "enum", {
                enum: [{ value: "enhanced", label: "Enhanced" }, { value: "basic", label: "Basic" }],
            }, { default: "enhanced" }),
        ],
    },
    runtime_configuration: { fields: [] },
}, "argumentation-tutor");

test("validateDesignServiceConfigurations: the tutor's evaluation_mode is validated by its descriptor", async () => {
    const validate = configuration => validateDesignServiceConfigurations({
        design:                   designWith(configuration, { enabled: [TUTOR], serviceId: TUTOR }),
        getInstanceConfiguration: async () => ({ available: true, fields: tutorDescriptor.fields }),
    });

    for (const evaluationMode of ["enhanced", "basic"]) {
        assert.deepEqual(await validate({ evaluation_mode: evaluationMode, llm_tier: "advanced" }),
            { errors: [], warnings: [] }, evaluationMode);
    }
    assert.deepEqual(await validate({ llm_tier: "basic" }), { errors: [], warnings: [] },
        "an unset mode takes the descriptor default");
    assert.deepEqual((await validate({ evaluation_mode: "turbo" })).errors, [{
        phaseIndex: 0, serviceId: TUTOR, field: "evaluation_mode", code: "not_in_enum", value: "turbo",
    }]);
});
