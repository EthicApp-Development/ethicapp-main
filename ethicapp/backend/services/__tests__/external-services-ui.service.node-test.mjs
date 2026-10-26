import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { captureWarnings } from "./capture-warnings.mjs";

// registerService() resolves adapter paths against the manifest path; the
// manifest file itself is never read.
const FIXTURES_MANIFEST = fileURLToPath(new URL("./fixtures/manifest.json", import.meta.url));
const TEN_MINUTES_MS    = 10 * 60 * 1000;
const ONE_MINUTE_MS     = 60 * 1000;

const TRANSLATIONS = {
    es_CL: {
        label:       "Case tool (es_CL)",
        description: "Analyses the case (es_CL).",
        tabTitle:    "Analysis (es_CL)",
    },
    en_US: {
        label:       "Case tool",
        description: "Analyses the case.",
        tabTitle:    "Analysis",
    },
};

function makeRegistry(options = {}) {
    const registry = new ExternalServicesRegistry({ jobsService: {}, ...options });
    registry.initialized = true;
    return registry;
}

// ─── ui.component (manifest) ─────────────────────────────────────────────────

test("registerService: keeps a kebab-case ui.component, drops others with a warning", async () => {
    const registry = makeRegistry();
    const entries  = [
        ["svc-panel", { component: "case-tool-panel" }],
        ["svc-camel", { component: "CaseToolPanel" }],
        ["svc-none", undefined],
    ];

    const { warnings } = await captureWarnings(async () => {
        for (const [id, ui] of entries) {
            const entry = { id, adapter: "./unused.adapter.js", ui, enabled: false };
            await registry.registerService(entry, FIXTURES_MANIFEST);
        }
    });

    assert.deepEqual(registry.services.get("svc-panel").ui, { component: "case-tool-panel" });
    assert.deepEqual(registry.services.get("svc-camel").ui, { component: null });
    assert.deepEqual(registry.services.get("svc-none").ui, { component: null });
    assert.equal(warnings.length, 1, "one warning for the invalid component");
    assert.ok(warnings[0].includes("CaseToolPanel"));
});

// #811: only an explicit "enabled": true enables a service.
test("registerService: without enabled, a service is disabled and not imported", async () => {
    const registry = makeRegistry();
    // The adapter path does not exist: importing it would fail.
    const entry = { id: "svc-implicit", adapter: "./missing.adapter.js" };
    await registry.registerService(entry, FIXTURES_MANIFEST);

    assert.equal(registry.services.get("svc-implicit").enabled, false);
    assert.deepEqual(registry.getGloballyEnabledServiceIds("case-created"), []);
    assert.equal([...registry.hookSubscribers.values()].flat().length, 0);
});

test("listServices: exposes ui and defaults it to { component: null } for legacy entries", () => {
    const registry = makeRegistry();
    registry.services.set("svc-panel", {
        id: "svc-panel", enabled: true, ui: { component: "case-tool-panel" },
    });
    registry.services.set("svc-legacy", { id: "svc-legacy", enabled: true });

    const listed = registry.listServices();
    assert.deepEqual(listed.find(s => s.id === "svc-panel").ui, { component: "case-tool-panel" });
    assert.deepEqual(listed.find(s => s.id === "svc-legacy").ui, { component: null });
});

// ─── adapter translations ────────────────────────────────────────────────────

test("registerService: serves the texts of the adapter's getUiTranslations()", async () => {
    const registry = makeRegistry();

    await registry.registerService({
        id:      "svc-case",
        adapter: "./translated-case-tool.adapter.js",
        scopes:  ["case"],
        enabled: true,
    }, FIXTURES_MANIFEST);

    assert.deepEqual(await registry.getServiceUiTranslations("svc-case"), TRANSLATIONS);
});

test("registerService: warns only for case-scoped adapters without translations", async () => {
    const registry = makeRegistry();

    const { warnings } = await captureWarnings(async () => {
        for (const [id, scopes] of [["svc-case", ["case"]], ["svc-chat", ["chat"]]]) {
            await registry.registerService({
                id,
                adapter: "./untranslated-tool.adapter.js",
                scopes,
                enabled: true,
            }, FIXTURES_MANIFEST);
        }
    });

    assert.equal(warnings.length, 1, "only the case-scoped service is reported");
    assert.ok(warnings[0].includes("getUiTranslations") && warnings[0].includes("svc-case"));
    assert.equal(await registry.getServiceUiTranslations("svc-case"), null);
    assert.equal(await registry.getServiceUiTranslations("svc-chat"), null);
});

// ─── getServiceUiTranslations ────────────────────────────────────────────────

test("getServiceUiTranslations: trims texts, keeps UI locales, defaults tabTitle", async () => {
    const registry = makeRegistry();
    registry.uiTranslationProviders.set("svc-case", async () => ({
        es_CL: { label: "  Case tool (es_CL) ", description: "Analyses the case (es_CL)." },
        en_US: {
            label:       "Case tool",
            description: "Analyses the case.",
            tabTitle:    "Analysis",
            extra:       true,
        },
        fr_FR: { label: "Case tool (fr_FR)", description: "Analyses the case (fr_FR)." },
    }));

    assert.deepEqual(await registry.getServiceUiTranslations("svc-case"), {
        es_CL: {
            label:       "Case tool (es_CL)",
            description: "Analyses the case (es_CL).",
            tabTitle:    null,
        },
        en_US: { label: "Case tool", description: "Analyses the case.", tabTitle: "Analysis" },
    });
});

test("getServiceUiTranslations: null when a locale lacks a label or a description", async () => {
    const invalidTranslations = [
        { es_CL: TRANSLATIONS.es_CL },
        { ...TRANSLATIONS, en_US: { label: "Case tool", description: " " } },
        { ...TRANSLATIONS, es_CL: { description: "Analyses the case (es_CL)." } },
        null,
    ];

    for (const translations of invalidTranslations) {
        const registry = makeRegistry();
        registry.uiTranslationProviders.set("svc-case", async () => translations);

        const { result, warnings } = await captureWarnings(
            () => registry.getServiceUiTranslations("svc-case")
        );

        assert.equal(result, null, JSON.stringify(translations));
        assert.equal(warnings.length, 1);
    }
});

test("getServiceUiTranslations: asks the adapter again only after ten minutes", async () => {
    let nowMs = 0;
    let calls = 0;
    const registry = makeRegistry({ now: () => nowMs });
    registry.uiTranslationProviders.set("svc-case", async () => {
        calls += 1;
        return TRANSLATIONS;
    });

    await registry.getServiceUiTranslations("svc-case");
    nowMs = TEN_MINUTES_MS - 1;
    assert.deepEqual(await registry.getServiceUiTranslations("svc-case"), TRANSLATIONS);
    assert.equal(calls, 1);

    nowMs = TEN_MINUTES_MS;
    await registry.getServiceUiTranslations("svc-case");
    assert.equal(calls, 2);
});

test("getServiceUiTranslations: a timeout yields null and retries after a minute", async () => {
    let nowMs = 0;
    let calls = 0;
    const registry = makeRegistry({ now: () => nowMs, uiTranslationsTimeoutMs: 5 });
    registry.uiTranslationProviders.set("svc-slow", () => {
        calls += 1;
        return new Promise(() => {});
    });

    const { result, warnings } = await captureWarnings(
        () => registry.getServiceUiTranslations("svc-slow")
    );
    assert.equal(result, null);
    assert.ok(warnings[0].includes("timed out"));

    nowMs = ONE_MINUTE_MS - 1;
    assert.equal(await registry.getServiceUiTranslations("svc-slow"), null);
    assert.equal(calls, 1, "no new attempt within the minute");

    nowMs = ONE_MINUTE_MS;
    await captureWarnings(() => registry.getServiceUiTranslations("svc-slow"));
    assert.equal(calls, 2);
});

test("getServiceUiTranslations: keeps the previous texts when a refresh fails", async () => {
    let nowMs = 0;
    let failing = false;
    const registry = makeRegistry({ now: () => nowMs });
    registry.uiTranslationProviders.set("svc-case", async () => {
        if (failing) {
            throw new Error("service unavailable");
        }
        return TRANSLATIONS;
    });

    await registry.getServiceUiTranslations("svc-case");
    failing = true;
    nowMs = TEN_MINUTES_MS;

    const { result, warnings } = await captureWarnings(
        () => registry.getServiceUiTranslations("svc-case")
    );
    assert.deepEqual(result, TRANSLATIONS);
    assert.ok(warnings[0].includes("service unavailable"));
});
