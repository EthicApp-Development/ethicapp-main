import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    ExternalServicesRegistry,
    SERVICE_SCOPES,
} from "../../services/external-services.service.js";
import { validateCatalog } from "../catalog.js";

const manifestUrl  = new URL("../manifest.json", import.meta.url);
const manifestPath = fileURLToPath(manifestUrl);
const manifest     = JSON.parse(await fs.readFile(manifestUrl, "utf8"));

function quietly(action) {
    const originalWarn = console.warn;
    const originalInfo = console.info;
    console.warn = () => {};
    console.info = () => {};
    return Promise.resolve()
        .then(action)
        .finally(() => {
            console.warn = originalWarn;
            console.info = originalInfo;
        });
}

// ─── The shipped catalog (#812) ──────────────────────────────────────────────

test("catalog: the shipped manifest is the only one and passes validation", async () => {
    const directory = fileURLToPath(new URL("..", import.meta.url));
    const manifests = (await fs.readdir(directory)).filter(name => /^manifest.*\.json$/u.test(name));

    assert.deepEqual(manifests, ["manifest.json"]);
    assert.deepEqual(validateCatalog(manifest), []);
});

test("catalog: each adapter requires its AI Additions service; mocks are development-only", () => {
    const declared = Object.fromEntries(manifest.services.map(service => [
        service.id,
        { development: service.development === true, requires: service.requires },
    ]));

    assert.deepEqual(declared, {
        "mock-ai-response-review":    { development: true, requires: [] },
        "mock-chat-agent":            { development: true, requires: [] },
        "polyadic-devils-advocate":   { development: false, requires: ["polyadic-agent"] },
        "argumentation-tutor-system": { development: false, requires: ["argumentation-tutor"] },
        "case-analyst-evaluation":    { development: false, requires: ["case-analyst"] },
        "mock-case-analysis":         { development: true, requires: [] },
        "mock-design-analysis":       { development: true, requires: [] },
    });
});

test("catalog: no service declares the removed enabled or capabilities keys", () => {
    for (const service of manifest.services) {
        assert.equal(Object.hasOwn(service, "enabled"), false, service.id);
        assert.equal(Object.hasOwn(service, "capabilities"), false, service.id);
    }
});

// Screens list services by scope, so an entry without one would silently
// disappear from them.
test("catalog: every service declares at least one known scope", () => {
    for (const service of manifest.services) {
        assert.ok(
            Array.isArray(service.scopes) && service.scopes.length > 0,
            `${service.id} declares no scopes`
        );

        for (const scope of service.scopes) {
            assert.ok(
                SERVICE_SCOPES.includes(scope),
                `${service.id} declares unknown scope "${scope}"`
            );
        }
    }
});

test("catalog: every service restricts who may post its callbacks", () => {
    for (const service of manifest.services) {
        assert.ok(
            Array.isArray(service.callbackAuth?.allowedClientIds)
                && service.callbackAuth.allowedClientIds.length > 0,
            `${service.id} has no callbackAuth.allowedClientIds`
        );
    }
});

// ─── Adapters, registered from the shipped catalog ───────────────────────────

// Development adapters are included so every adapter is checked.
async function registerCatalog() {
    const registry = new ExternalServicesRegistry({ jobsService: {}, developmentAdapters: true });
    await quietly(() => registry.initialize(manifestPath));
    return registry;
}

// Case screens show each case-scoped service by its translated texts.
test("catalog: every case-scoped service provides UI translations", async () => {
    const registry = await registerCatalog();
    const caseServices = manifest.services.filter(service => service.scopes?.includes("case"));

    for (const service of caseServices) {
        assert.ok(
            await registry.getServiceUiTranslations(service.id),
            `${service.id} provides no valid es_CL and en_US translations`
        );
    }
});

// Design screens show each design-scoped service by its translated texts, and
// saving a design runs only services that say whether they apply (#848).
test("catalog: every design-scoped service provides UI translations and an input export", async () => {
    const registry = await registerCatalog();
    const designServices = manifest.services.filter(service => service.scopes?.includes("design"));

    for (const service of designServices) {
        assert.ok(
            await registry.getServiceUiTranslations(service.id),
            `${service.id} provides no valid es_CL and en_US translations`
        );
        assert.equal(
            typeof registry.getDesignAnalysisInputBuilder(service.id),
            "function",
            `${service.id} exports no designAnalysisInput()`
        );
    }
});

// The AI services publish their configuration through capability descriptors,
// under ids that differ from the catalog ids (#725). The descriptor id is the
// service the adapter requires (#812).
test("catalog: AI services declare their capability descriptor", async () => {
    const registry = await registerCatalog();
    const expected = {
        "polyadic-devils-advocate": {
            serviceId: "polyadic-agent",
            path:      "/polyadic-agent/api/capabilities",
        },
        "argumentation-tutor-system": {
            serviceId: "argumentation-tutor",
            path:      "/argumentation-tutor/api/capabilities",
        },
    };

    for (const service of manifest.services) {
        assert.deepEqual(
            registry.getServiceDescriptor(service.id),
            expected[service.id] ?? null,
            service.id,
        );
    }
});

// AI services name themselves even when their AI service does not respond (#757).
test("catalog: AI services provide UI translations", async () => {
    const registry = await registerCatalog();

    for (const serviceId of ["polyadic-devils-advocate", "argumentation-tutor-system"]) {
        const translations = await quietly(() => registry.getServiceUiTranslations(serviceId));
        assert.ok(translations, `${serviceId} provides no valid es_CL and en_US translations`);
        assert.notEqual(translations.es_CL.label, translations.en_US.label, serviceId);
    }
});

// ─── Case Analyst: case evaluation (#844) ────────────────────────────────────

test("catalog: the case evaluation is a read-only case analysis called back by Case Analyst", async () => {
    const entry = manifest.services.find(service => service.id === "case-analyst-evaluation");

    assert.ok(entry, "case-analyst-evaluation is in the catalog");
    assert.equal(manifest.services.some(service => service.id === "case-analyst"), false);
    assert.deepEqual(entry.requires, ["case-analyst"]);
    assert.deepEqual(entry.scopes, ["case"]);
    assert.deepEqual(entry.hooks, ["case-created", "callback-received"]);
    assert.deepEqual(entry.ui, { component: "case-evaluation" });
    assert.deepEqual(entry.callbackAuth.allowedClientIds, ["case-analyst-api"]);

    // Without a validator, teacher edits answer 405.
    const registry = await registerCatalog();
    assert.equal(registry.getCaseAnalysisValidator("case-analyst-evaluation"), null);
});
