import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    compactSettingsLine,
    phaseEnabledServiceIds,
    phaseServiceConfiguration,
    serviceDisplayName,
    storedSettingRows,
    summarizeServiceSettings,
} from "../service-configuration-summary.js";

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

const ENTRY = (value, label, extra = {}) => ({
    value, label, status: "active", supersededBy: null, ...extra,
});

const TIER = field("llm_tier", "enum", {
    entries: [ENTRY("basic", "Básico"), ENTRY("advanced", "Avanzado"),
        ENTRY("legacy", "Legado", { status: "deprecated", supersededBy: "basic" })],
}, { label: "Nivel del modelo", default: "basic", group: "General", order: 1 });
const MODEL = field("model", "enum", { entries: [ENTRY("gpt-4o-mini", "GPT-4o mini")] },
    {
        label: "Modelo", group: "General", order: 2, status: "deprecated", supersededBy: "llm_tier",
    });
const ANONYMOUS = field("anonymous_guide", "boolean", {},
    { label: "Guía anónimo", default: true, group: "General", order: 3 });
const DURATION = field("session_duration_seconds", "integer",
    { minimum: 300, maximum: 7200, step: 60 },
    { label: "Duración", default: 600, group: "Tiempo", order: 4 });
const NICKNAME = field("agent_nickname", "text", { maxLength: 80, pattern: null, multiline: false },
    { label: "Apodo", group: "Presentación", order: 5 });
const FIELDS = [TIER, MODEL, ANONYMOUS, DURATION, NICKNAME];

function rowsByKey(summary) {
    return Object.fromEntries(summary.rows.map(row => [row.key, row]));
}

describe("phase external services summary (#757)", () => {
    it("reads the phase's enabled services and their stored settings", () => {
        const phase = {
            externalServices: {
                enabledServiceIds: [" polyadic ", "tutor", "polyadic", "", 7],
                configurations:    { polyadic: { llm_tier: "advanced" }, tutor: "invalid" },
            },
        };

        assert.deepEqual(phaseEnabledServiceIds(phase), ["polyadic", "tutor", "7"]);
        assert.deepEqual(phaseServiceConfiguration(phase, "polyadic"), { llm_tier: "advanced" });
        assert.deepEqual(phaseServiceConfiguration(phase, "tutor"), {});
        assert.deepEqual(phaseEnabledServiceIds({}), []);
        assert.deepEqual(phaseEnabledServiceIds(undefined), []);
    });

    it("names a service by its UI translation, then its descriptor, else not at all", () => {
        const translated = {
            ui:         { translations: { es_CL: { label: "Analista" } } },
            descriptor: { name: "Case Analyst" },
        };

        assert.equal(serviceDisplayName(translated, "es_CL"), "Analista");
        assert.equal(serviceDisplayName(translated, "en_US"), "Case Analyst");
        assert.equal(serviceDisplayName({ descriptor: null }, "es_CL"), null);
        assert.equal(serviceDisplayName(undefined, "es_CL"), null,
            "a disabled or unknown service has no friendly name");
    });

    it("shows stored values in readable form", () => {
        const rows = rowsByKey(summarizeServiceSettings(FIELDS, {
            llm_tier:                 "advanced",
            anonymous_guide:          false,
            session_duration_seconds: 900,
            agent_nickname:           "Sofía",
        }));

        assert.deepEqual(
            [
                rows.llm_tier.text,
                rows.anonymous_guide.booleanValue,
                rows.session_duration_seconds.text,
                rows.agent_nickname.text,
            ],
            ["Avanzado", false, "900", "Sofía"]
        );
        assert.equal(Object.values(rows).some(row => row.isDefault), false);
    });

    it("shows the service default for unset fields, marked as the default", () => {
        const rows = rowsByKey(summarizeServiceSettings(FIELDS, {}));

        assert.deepEqual(rows.llm_tier, {
            key:          "llm_tier", label:        "Nivel del modelo", group:        "General",
            isDefault:    true, text:         "Básico", booleanValue: null, notice:       null,
            errorParams:  {
                minimum: undefined, maximum: undefined, step: undefined, maxLength: undefined,
            },
        });
        assert.equal(rows.session_duration_seconds.errorParams.minimum, 300);
        assert.equal(rows.anonymous_guide.booleanValue, true);
        assert.equal(rows.anonymous_guide.text, null);
        assert.equal(rows.session_duration_seconds.text, "600");
        assert.equal(rows.agent_nickname.text, null, "no default to show");
        assert.equal(rows.agent_nickname.isDefault, true);
    });

    it("lists fields in the form's order and hides unset deprecated fields", () => {
        assert.deepEqual(summarizeServiceSettings(FIELDS, {}).rows.map(row => row.key),
            ["llm_tier", "anonymous_guide", "session_duration_seconds", "agent_nickname"]);
        assert.equal(summarizeServiceSettings(FIELDS, { model: "gpt-4o-mini" }).rows
            .some(row => row.key === "model"), true);
    });

    it("carries the editor's lifecycle notices (#733)", () => {
        const summary = summarizeServiceSettings(FIELDS, {
            model:                    "gpt-4o-mini",
            llm_tier:                 "turbo",
            session_duration_seconds: 120,
            idioma:                   "english",
        });
        const rows = rowsByKey(summary);

        assert.equal(rows.model.notice.kind, "deprecated_field");
        assert.equal(rows.model.text, "GPT-4o mini");
        assert.deepEqual(rows.llm_tier.notice, { kind: "retired_value", defaultText: "Básico" });
        assert.equal(rows.llm_tier.text, "turbo", "a retired value is shown as stored");
        assert.equal(rows.session_duration_seconds.notice.kind, "no_longer_valid");
        assert.deepEqual(summary.retiredFields, [{ key: "idioma", value: "english" }]);
    });

    it("shows a deprecated enum value with its label and notice", () => {
        const rows = rowsByKey(summarizeServiceSettings(FIELDS, { llm_tier: "legacy" }));

        assert.equal(rows.llm_tier.text, "Legado");
        assert.equal(rows.llm_tier.notice.kind, "deprecated_value");
    });

    it("falls back to stored key: value rows without labels", () => {
        assert.deepEqual(storedSettingRows({
            llm_tier:                 "advanced",
            session_duration_seconds: 900,
            anonymous_guide:          false,
            unset:                    null,
        }), [
            { key: "llm_tier", text: "advanced" },
            { key: "session_duration_seconds", text: "900" },
            { key: "anonymous_guide", text: "false" },
        ]);
        assert.deepEqual(storedSettingRows({}), []);
    });
});

describe("compactSettingsLine (#894)", () => {
    it("joins the first values shown as text", () => {
        const rows = [
            { key: "style", text: "básico", booleanValue: null },
            { key: "anonymous", text: null, booleanValue: true },
            { key: "minutes", text: "15 min", booleanValue: null },
            { key: "language", text: "  ", booleanValue: null },
            { key: "agents", text: "2", booleanValue: null },
            { key: "model", text: "small", booleanValue: null },
        ];
        assert.equal(compactSettingsLine(rows), "básico · 15 min · 2");
        assert.equal(compactSettingsLine(rows, 1), "básico");
    });

    it("is empty without rows", () => {
        assert.equal(compactSettingsLine([]), "");
        assert.equal(compactSettingsLine(undefined), "");
    });
});
