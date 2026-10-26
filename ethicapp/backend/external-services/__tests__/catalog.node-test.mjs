import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    AI_ADDITIONS_SERVICE_IDS,
    developmentAdaptersEnabled,
    validateCatalog,
    validateCatalogEntry,
} from "../catalog.js";
import { ExternalServicesRegistry } from "../../services/external-services.service.js";

function productionEntry(overrides = {}) {
    return {
        id:       "svc-production",
        adapter:  "./adapters/svc.adapter.js",
        requires: ["polyadic-agent"],
        ...overrides,
    };
}

function developmentEntry(overrides = {}) {
    return {
        id:          "svc-development",
        adapter:     "./adapters/mock.adapter.js",
        development: true,
        requires:    [],
        ...overrides,
    };
}

function assertProblem(entry, fragment) {
    const problems = validateCatalogEntry(entry);
    assert.ok(
        problems.some(problem => problem.includes(fragment)),
        `expected a problem with "${fragment}", got ${JSON.stringify(problems)}`
    );
}

// ─── validateCatalogEntry ────────────────────────────────────────────────────

test("AI_ADDITIONS_SERVICE_IDS: the AI Additions services adapters may require", () => {
    assert.deepEqual(AI_ADDITIONS_SERVICE_IDS, ["polyadic-agent", "argumentation-tutor", "case-analyst"]);
});

test("validateCatalogEntry: accepts production and development adapters", () => {
    assert.deepEqual(validateCatalogEntry(productionEntry()), []);
    assert.deepEqual(validateCatalogEntry(productionEntry({
        requires: ["polyadic-agent", "case-analyst"],
    })), []);
    assert.deepEqual(validateCatalogEntry(productionEntry({
        requires:   ["argumentation-tutor"],
        descriptor: { path: "/argumentation-tutor/api/capabilities" },
    })), []);
    assert.deepEqual(validateCatalogEntry(developmentEntry()), []);
});

test("validateCatalogEntry: rejects a missing requires", () => {
    for (const requires of [undefined, null, "polyadic-agent", { id: "polyadic-agent" }]) {
        assertProblem(productionEntry({ requires }), "`requires` is missing");
    }
    const { requires, ...withoutRequires } = developmentEntry();
    assert.deepEqual(requires, []);
    assertProblem(withoutRequires, "`requires` is missing");
});

test("validateCatalogEntry: rejects unknown or repeated AI Additions services", () => {
    assertProblem(productionEntry({ requires: ["polyadic-agents"] }), "unknown AI Additions services (polyadic-agents)");
    assertProblem(productionEntry({ requires: ["polyadic-agent", 7] }), "unknown AI Additions services (7)");
    assertProblem(productionEntry({ requires: ["case-analyst", "case-analyst"] }), "more than once");
});

test("validateCatalogEntry: a production adapter requires at least one service", () => {
    assertProblem(productionEntry({ requires: [] }), "only development adapters require no");
    assertProblem(productionEntry({ requires: [], development: false }), "only development adapters require no");
});

test("validateCatalogEntry: a development adapter requires no service", () => {
    assertProblem(developmentEntry({ requires: ["polyadic-agent"] }), "must declare `requires: []`");
    assertProblem(developmentEntry({ development: "true" }), "`development` must be a boolean");
});

test("validateCatalogEntry: rejects the removed enabled key", () => {
    for (const enabled of [true, false]) {
        assertProblem(productionEntry({ enabled }), "`enabled` is removed");
    }
});

test("validateCatalogEntry: a descriptor belongs to exactly one required service", () => {
    assertProblem(productionEntry({
        requires:   ["polyadic-agent", "case-analyst"],
        descriptor: { path: "/polyadic-agent/api/capabilities" },
    }), "exactly one service");
    assertProblem(productionEntry({
        descriptor: { serviceId: "polyadic-agent", path: "/polyadic-agent/api/capabilities" },
    }), "`descriptor.serviceId` is replaced by `requires`");
});

test("validateCatalogEntry: requires an id and an adapter", () => {
    assertProblem(productionEntry({ id: "" }), "`id`");
    assertProblem(productionEntry({ adapter: undefined }), "`adapter`");
    assert.deepEqual(validateCatalogEntry(null), ["must be an object"]);
});

// ─── validateCatalog ─────────────────────────────────────────────────────────

test("validateCatalog: prefixes problems with the entry and rejects duplicate ids", () => {
    const problems = validateCatalog({
        services: [
            productionEntry(),
            productionEntry(),
            productionEntry({ id: "svc-broken", requires: undefined }),
        ],
    });

    assert.deepEqual(problems.map(problem => problem.split(":")[0]), ["svc-production", "svc-broken"]);
    assert.ok(problems[0].includes("duplicate id"));
    assert.deepEqual(validateCatalog({}), ["`services` must be an array"]);
});

// ─── The registry refuses an invalid catalog ─────────────────────────────────

test("registerService: throws on an invalid entry and registers nothing", async () => {
    const registry = new ExternalServicesRegistry({
        jobsService:   {},
        importAdapter: async () => assert.fail("an invalid entry must not be imported"),
    });

    await assert.rejects(
        () => registry.registerService(productionEntry({ requires: ["unknown-service"] }), "/x/manifest.json"),
        /Invalid adapter catalog \/x\/manifest\.json:\n- svc-production: `requires` names unknown/
    );
    assert.equal(registry.services.size, 0);
});

test("initialize: throws on a catalog with a missing requires and stays uninitialized", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-catalog-"));
    const manifestPath = path.join(directory, "manifest.json");

    try {
        await fs.writeFile(manifestPath, JSON.stringify({
            services: [productionEntry({ requires: undefined })],
        }));
        const registry = new ExternalServicesRegistry({
            jobsService:   {},
            importAdapter: async () => assert.fail("nothing is imported from an invalid catalog"),
        });

        await assert.rejects(() => registry.initialize(manifestPath), /`requires` is missing/);
        assert.equal(registry.initialized, false);
        assert.equal(registry.services.size, 0);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("initialize: throws when the catalog file is missing", async () => {
    const registry = new ExternalServicesRegistry({ jobsService: {} });

    await assert.rejects(() => registry.initialize("/nonexistent/manifest.json"), { code: "ENOENT" });
    assert.equal(registry.initialized, false);
});

// ─── EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS ──────────────────────────────────

test("developmentAdaptersEnabled: only an explicit true enables development adapters", () => {
    for (const value of ["true", "TRUE", " true "]) {
        assert.equal(developmentAdaptersEnabled({ EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS: value }), true, value);
    }
    for (const value of [undefined, "", "false", "1", "yes", "on"]) {
        assert.equal(developmentAdaptersEnabled({ EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS: value }), false, value);
    }
});
