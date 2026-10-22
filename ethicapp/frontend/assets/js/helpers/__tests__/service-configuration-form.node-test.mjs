import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildFieldSections,
    configurationErrors,
    controlKind,
    defaultText,
    enumOptions,
    errorParameters,
    readControlValue,
    setConfigurationValue,
} from "../service-configuration-form.js";

// Normalized descriptor fields, as GET /external-services/:id/instance-configuration returns them.
function field(key, type, validation, extra = {}) {
    return {
        key,
        type,
        required:     false,
        default:      null,
        label:        key,
        description:  null,
        group:        null,
        order:        null,
        status:       "active",
        supersededBy: null,
        validation,
        ...extra,
    };
}

const TIER = field("llm_tier", "enum", {
    entries: [
        { value: "basic", label: "Básico", status: "active", supersededBy: null },
        { value: "advanced", label: "Avanzado", status: "active", supersededBy: null },
        { value: "legacy", label: "Legado", status: "deprecated", supersededBy: "basic" },
    ],
}, { default: "basic", group: "General", order: 5 });
const MODEL = field("model", "enum", {
    entries: [{ value: "gpt-4o-mini", label: "GPT-4o mini", status: "active", supersededBy: null }],
}, { group: "General", order: 6, status: "deprecated", supersededBy: "llm_tier" });
const DURATION = field("session_duration_seconds", "integer",
    { minimum: 300, maximum: 7200, step: 60 }, { default: 600, group: "Tiempo", order: 40 });
const NICKNAME = field("agent_nickname", "text",
    { maxLength: 10, pattern: null, multiline: false }, { group: "Presentación", order: 30 });
const NOTES = field("notes", "text", { maxLength: 200, pattern: null, multiline: true });
const ANONYMOUS = field("anonymous_guide", "boolean", {},
    { default: true, group: "General", order: 1 });
const FIELDS = [TIER, MODEL, DURATION, NICKNAME, NOTES, ANONYMOUS];

describe("service configuration form (#732)", () => {
    it("groups visible fields by group, ordered by order", () => {
        const sections = buildFieldSections(FIELDS);

        assert.deepEqual(sections.map(section => [section.group, section.fields.map(f => f.key)]), [
            ["General", ["anonymous_guide", "llm_tier"]],
            ["Presentación", ["agent_nickname"]],
            ["Tiempo", ["session_duration_seconds"]],
            [null, ["notes"]],
        ]);
    });

    it("shows a deprecated field only while the design stores a value for it", () => {
        const keys = configuration => buildFieldSections(FIELDS, configuration)
            .flatMap(section => section.fields.map(f => f.key));

        assert.equal(keys({}).includes("model"), false);
        assert.equal(keys({ model: "gpt-4o-mini" }).includes("model"), true);
    });

    it("picks a control per field type", () => {
        assert.deepEqual(FIELDS.map(controlKind),
            ["select", "select", "number", "text", "textarea", "checkbox"]);
    });

    it("offers deprecated enum entries only while selected", () => {
        assert.deepEqual(enumOptions(TIER, "basic").map(entry => entry.value),
            ["basic", "advanced"]);
        assert.deepEqual(enumOptions(TIER, "legacy").map(entry => entry.value),
            ["basic", "advanced", "legacy"]);
    });

    it("describes defaults for placeholders", () => {
        assert.equal(defaultText(TIER), "Básico");
        assert.equal(defaultText(DURATION), "600");
        assert.equal(defaultText(NICKNAME), "");
    });

    it("reads control values, treating empty inputs as unset", () => {
        assert.equal(readControlValue(DURATION, ""), undefined);
        assert.equal(readControlValue(DURATION, undefined), undefined);
        assert.equal(readControlValue(DURATION, 900), 900);
        assert.equal(readControlValue(DURATION, "900"), 900);
        assert.equal(readControlValue(DURATION, "abc"), "abc");
        assert.equal(readControlValue(NICKNAME, ""), undefined);
        assert.equal(readControlValue(NICKNAME, " Sofía "), " Sofía ");
        assert.equal(readControlValue(TIER, ""), undefined);
        assert.equal(readControlValue(ANONYMOUS, false), false);
    });

    it("stores only set values and drops empty service entries", () => {
        const configurations = { other: { x: 1 } };

        setConfigurationValue(configurations, "svc", "llm_tier", "advanced");
        setConfigurationValue(configurations, "svc", "anonymous_guide", false);
        assert.deepEqual(configurations.svc, { llm_tier: "advanced", anonymous_guide: false });

        setConfigurationValue(configurations, "svc", "llm_tier", undefined);
        assert.deepEqual(configurations.svc, { anonymous_guide: false });

        setConfigurationValue(configurations, "svc", "anonymous_guide", null);
        assert.equal(Object.hasOwn(configurations, "svc"), false);
        assert.deepEqual(configurations.other, { x: 1 });
    });

    it("reports errors for values the teacher sets, with the server's codes", () => {
        assert.deepEqual(configurationErrors(FIELDS, {}), {});
        assert.deepEqual(configurationErrors(FIELDS, { session_duration_seconds: 900 }), {});
        assert.deepEqual(configurationErrors(FIELDS, {
            session_duration_seconds: 125,
            agent_nickname:           "Sofía la guía",
            llm_tier:                 "premium",
        }), {
            session_duration_seconds: "below_minimum",
            agent_nickname:           "too_long",
            llm_tier:                 "not_in_enum",
        });
        assert.deepEqual(configurationErrors(FIELDS, { session_duration_seconds: "abc" }),
            { session_duration_seconds: "invalid_type" });
    });

    it("does not block on problems the stored value already had (#731)", () => {
        const stored = [{ session_duration_seconds: 900 }, { llm_tier: "turbo" }];

        assert.deepEqual(configurationErrors(FIELDS, { llm_tier: "turbo" }, stored), {},
            "stored in another phase counts too, as on the server");
        assert.deepEqual(configurationErrors(FIELDS, { llm_tier: "hyper" }, stored),
            { llm_tier: "not_in_enum" });
    });

    it("requires required fields once the service has a configuration", () => {
        const required = [{ ...NICKNAME, required: true }, DURATION];

        assert.deepEqual(configurationErrors(required, {}), {});
        assert.deepEqual(configurationErrors(required, { session_duration_seconds: 900 }),
            { agent_nickname: "required" });
        assert.deepEqual(configurationErrors(required, { session_duration_seconds: 960 },
            [{ session_duration_seconds: 900 }]), {},
        "already missing in the stored configuration");
    });

    it("exposes the limits for error messages", () => {
        assert.deepEqual(errorParameters(DURATION),
            { minimum: 300, maximum: 7200, step: 60, maxLength: undefined });
        assert.equal(errorParameters(NICKNAME).maxLength, 10);
    });
});
