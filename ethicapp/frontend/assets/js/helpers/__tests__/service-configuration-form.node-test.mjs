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
    settingNotices,
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

    it("offers a stored retired enum value so the select can show it (#733)", () => {
        const options = enumOptions(TIER, "turbo", value => `${value} (retired)`);

        assert.deepEqual(options.at(-1),
            { value: "turbo", label: "turbo (retired)", status: "retired" });
        assert.equal(enumOptions(TIER, undefined).some(entry => entry.status === "retired"), false);
    });
});

describe("lifecycle notices (#733)", () => {
    it("has nothing to say about current values or unset deprecated fields", () => {
        const current = { llm_tier: "advanced", session_duration_seconds: 900 };
        assert.deepEqual(settingNotices(FIELDS, current),
            { byField: {}, retiredFields: [] });
        assert.deepEqual(settingNotices(FIELDS, {}), { byField: {}, retiredFields: [] });
    });

    it("flags a stored deprecated field and offers the field that replaces it", () => {
        const { byField } = settingNotices(FIELDS, { model: "gpt-4o-mini" });

        assert.deepEqual(byField.model, {
            kind:        "deprecated_field",
            replacement: { kind: "field", key: "llm_tier", label: "llm_tier" },
        });
    });

    it("offers no replacement when the descriptor does not have it", () => {
        const orphan = { ...MODEL, supersededBy: "retired_field" };

        assert.deepEqual(settingNotices([orphan], { model: "gpt-4o-mini" }).byField.model,
            { kind: "deprecated_field", replacement: null });
    });

    it("flags a stored deprecated enum value and offers its replacement", () => {
        const { byField } = settingNotices(FIELDS, { llm_tier: "legacy" });

        assert.deepEqual(byField.llm_tier, {
            kind:        "deprecated_value",
            replacement: { kind: "value", value: "basic", label: "Básico" },
        });
    });

    it("flags a retired enum value with the default the service applies", () => {
        const { byField } = settingNotices(FIELDS, { llm_tier: "turbo" });

        assert.deepEqual(byField.llm_tier, { kind: "retired_value", defaultText: "Básico" });
    });

    it("flags a stored value that breaks a current rule", () => {
        const { byField } = settingNotices(FIELDS, { session_duration_seconds: 120 });

        assert.deepEqual(byField.session_duration_seconds,
            { kind: "no_longer_valid", reason: "below_minimum" });
    });

    it("lists stored settings the descriptor no longer defines", () => {
        const stored = { idioma: "english", old_flag: true, gone: null };
        const { retiredFields } = settingNotices(FIELDS, stored);

        assert.deepEqual(retiredFields, [
            { key: "idioma", value: "english" },
            { key: "old_flag", value: true },
        ]);
    });
});

// The tutor's evaluation mode (#870, ethicapp-ai-additions#211) needs no
// bespoke UI: the descriptor's enum field, translated by the descriptor's
// locale, renders as a select whose "default" option names "Enhanced".
describe("the tutor's evaluation_mode field (#870)", () => {
    const entry = (value, label) => ({ value, label, status: "active", supersededBy: null });
    const MODE_FIELDS = {
        es_CL: field("evaluation_mode", "enum",
            { entries: [entry("enhanced", "Mejorado"), entry("basic", "Básico")] },
            { default: "enhanced", label: "Modo de evaluación", group: "General", order: 7 }),
        en_US: field("evaluation_mode", "enum",
            { entries: [entry("enhanced", "Enhanced"), entry("basic", "Basic")] },
            { default: "enhanced", label: "Evaluation Mode", group: "General", order: 7 }),
    };

    it("renders as a select after the tier, defaulting to enhanced, in both locales", () => {
        for (const [locale, expectedDefault] of [["es_CL", "Mejorado"], ["en_US", "Enhanced"]]) {
            const modeField = MODE_FIELDS[locale];
            const sections = buildFieldSections([TIER, modeField]);

            assert.deepEqual(sections.map(section => section.fields.map(f => f.key)),
                [["llm_tier", "evaluation_mode"]], locale);
            assert.equal(controlKind(modeField), "select");
            assert.equal(defaultText(modeField), expectedDefault, locale);
            assert.deepEqual(enumOptions(modeField, undefined).map(option => option.value),
                ["enhanced", "basic"], locale);
        }
    });

    it("stores basic, and removes the value to go back to the default", () => {
        const modeField = MODE_FIELDS.en_US;
        const configurations = {};

        setConfigurationValue(configurations, "argumentation-tutor-system", "evaluation_mode",
            readControlValue(modeField, "basic"));
        assert.deepEqual(configurations, { "argumentation-tutor-system": { evaluation_mode: "basic" } });
        assert.deepEqual(configurationErrors([modeField], configurations["argumentation-tutor-system"]), {});

        setConfigurationValue(configurations, "argumentation-tutor-system", "evaluation_mode",
            readControlValue(modeField, ""));
        assert.deepEqual(configurations, {}, "an unset mode is the descriptor default");
    });
});

