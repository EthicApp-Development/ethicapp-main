import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    AI_ADDITIONS_SERVICE_IDS,
    catalogWarnings,
    DESIGN_ANALYSIS_UNITS,
    developmentAdaptersEnabled,
    manifestStudentOutputs,
    REPORT_BUILDING_HOOK,
    validateCatalog,
    validateCatalogEntry,
} from "../catalog.js";
import { ExternalServicesRegistry } from "../../services/external-services.service.js";
import { captureWarnings } from "../../services/__tests__/capture-warnings.mjs";

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

// ─── produces and consumes (#863) ────────────────────────────────────────────

const TYPOLOGY_PER_QUESTION = Object.freeze({ documentSchema: "claim-typology/v1", unit: "question" });

test("DESIGN_ANALYSIS_UNITS: questions are the one unit so far", () => {
    assert.deepEqual(DESIGN_ANALYSIS_UNITS, ["question"]);
});

test("validateCatalogEntry: accepts design analysis producers and consumers", () => {
    assert.deepEqual(validateCatalogEntry(productionEntry({
        requires: ["case-analyst"],
        scopes:   ["design"],
        produces: [TYPOLOGY_PER_QUESTION],
    })), []);
    assert.deepEqual(validateCatalogEntry(productionEntry({
        scopes:   ["response"],
        consumes: [TYPOLOGY_PER_QUESTION, { documentSchema: "argument-map/v12", unit: "question" }],
    })), []);
    assert.deepEqual(validateCatalogEntry(developmentEntry({ produces: [], consumes: [] })), []);
});

test("validateCatalogEntry: rejects malformed produces and consumes", () => {
    for (const key of ["produces", "consumes"]) {
        const entry = items => productionEntry({ scopes: ["design"], [key]: items });

        for (const declaration of [null, "claim-typology/v1", TYPOLOGY_PER_QUESTION]) {
            assertProblem(entry(declaration), `\`${key}\` must be a list`);
        }
        assertProblem(entry(["claim-typology/v1"]), `\`${key}[0]\` must be an object`);
        assertProblem(entry([null]), `\`${key}[0]\` must be an object`);
        assertProblem(entry([TYPOLOGY_PER_QUESTION, { unit: "question" }]), `\`${key}[1]\`.documentSchema`);
        for (const documentSchema of ["", "claim-typology", "Claim-Typology/v1", "claim-typology/v0", 7]) {
            assertProblem(entry([{ documentSchema, unit: "question" }]), `\`${key}[0]\`.documentSchema`);
        }
        for (const unit of [undefined, "", "phase", "QUESTION"]) {
            assertProblem(entry([{ documentSchema: "claim-typology/v1", unit }]), `\`${key}[0]\`.unit must be one of question`);
        }
        assertProblem(entry([{ ...TYPOLOGY_PER_QUESTION, serviceId: "x" }]), `\`${key}[0]\` has unknown keys (serviceId)`);
        assertProblem(entry([TYPOLOGY_PER_QUESTION, { ...TYPOLOGY_PER_QUESTION }]), "claim-typology/v1 per question more than once");
    }
});

test("validateCatalogEntry: a producer needs the design scope", () => {
    for (const scopes of [undefined, [], ["case"], "design"]) {
        assertProblem(
            productionEntry({ scopes, produces: [TYPOLOGY_PER_QUESTION] }),
            "`produces` design analyses needs the `design` scope"
        );
    }
    assert.deepEqual(validateCatalogEntry(productionEntry({ produces: [] })), []);
});

test("catalogWarnings: a consumption without a producer of the same unit", () => {
    const producer = productionEntry({ id: "producer", scopes: ["design"], produces: [TYPOLOGY_PER_QUESTION] });
    const consumer = productionEntry({ id: "consumer", consumes: [TYPOLOGY_PER_QUESTION] });
    const orphan = productionEntry({
        id:       "orphan",
        consumes: [TYPOLOGY_PER_QUESTION, { documentSchema: "argument-map/v1", unit: "question" }],
    });

    assert.deepEqual(catalogWarnings({ services: [producer, consumer] }), []);
    assert.deepEqual(catalogWarnings({ services: [consumer] }), [
        "consumer: consumes claim-typology/v1 per question, which no adapter in the catalog produces",
    ]);
    assert.deepEqual(catalogWarnings({ services: [producer, orphan] }), [
        "orphan: consumes argument-map/v1 per question, which no adapter in the catalog produces",
    ]);
    assert.deepEqual(catalogWarnings({ services: [producer] }), [], "a producer without consumers is fine");
    assert.deepEqual(catalogWarnings({}), []);
});

test("initialize: a consumption without a producer is a warning, not an error", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-catalog-"));
    const manifestPath = path.join(directory, "manifest.json");

    try {
        await fs.writeFile(manifestPath, JSON.stringify({
            services: [productionEntry({ scopes: ["response"], consumes: [TYPOLOGY_PER_QUESTION] })],
        }));
        const registry = new ExternalServicesRegistry({
            jobsService:   {},
            importAdapter: async () => ({ register: async () => {} }),
        });

        const { warnings } = await captureWarnings(async () => {
            const originalInfo = console.info;
            console.info = () => {};
            try {
                await registry.initialize(manifestPath);
            } finally {
                console.info = originalInfo;
            }
        });

        assert.equal(registry.initialized, true);
        assert.ok(
            warnings.some(warning => warning.includes("svc-production: consumes claim-typology/v1 per question")),
            JSON.stringify(warnings)
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("initialize: a malformed produces rejects the catalog", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-catalog-"));
    const manifestPath = path.join(directory, "manifest.json");

    try {
        await fs.writeFile(manifestPath, JSON.stringify({
            services: [productionEntry({ scopes: ["design"], produces: [{ documentSchema: "claim-typology" }] })],
        }));
        const registry = new ExternalServicesRegistry({
            jobsService:   {},
            importAdapter: async () => assert.fail("nothing is imported from an invalid catalog"),
        });

        await assert.rejects(() => registry.initialize(manifestPath), /svc-production: `produces\[0\]`\.documentSchema/);
        assert.equal(registry.initialized, false);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

// ─── studentOutputs of development adapters (#1134) ──────────────────────────

function mockReviewOutput(overrides = {}) {
    return {
        id:             "mock-review",
        documentSchema: "student-result/v1",
        scopes:         ["response"],
        label:          "Mock review",
        description:    "Development review of each response.",
        ...overrides,
    };
}

test("manifestStudentOutputs: a development adapter declares its student outputs, normalized", () => {
    const entry = developmentEntry({ scopes: ["response", "chat"], studentOutputs: [mockReviewOutput()] });

    assert.deepEqual(validateCatalogEntry(entry), []);
    assert.deepEqual(manifestStudentOutputs(entry), {
        studentOutputs: [mockReviewOutput()],
        problems:       [],
    });
    assert.deepEqual(manifestStudentOutputs(developmentEntry()), { studentOutputs: null, problems: [] });
    assert.deepEqual(
        manifestStudentOutputs(developmentEntry({ scopes: ["response"], studentOutputs: [] })),
        { studentOutputs: [], problems: [] }
    );
});

test("validateCatalogEntry: a production adapter cannot declare student outputs in the catalog", () => {
    for (const entry of [
        productionEntry({ scopes: ["response"], studentOutputs: [mockReviewOutput()] }),
        productionEntry({ scopes: ["response"], development: false, studentOutputs: [] }),
        productionEntry({
            requires:       ["argumentation-tutor"],
            scopes:         ["response"],
            descriptor:     { path: "/argumentation-tutor/api/capabilities" },
            studentOutputs: [mockReviewOutput()],
        }),
    ]) {
        assertProblem(entry, "`studentOutputs` is only for development adapters");
        assert.equal(manifestStudentOutputs(entry).studentOutputs, null);
    }
});

test("validateCatalogEntry: rejects malformed student outputs of a development adapter", () => {
    const entry = studentOutputs => developmentEntry({ scopes: ["response"], studentOutputs });

    assertProblem(entry({ id: "mock-review" }), "`studentOutputs` must be a list");
    assertProblem(entry(["mock-review"]), "`studentOutputs[0]` must be an object");
    assertProblem(entry([mockReviewOutput({ display: {} })]), "`studentOutputs[0]` has unknown keys (display)");
    assertProblem(entry([mockReviewOutput({ id: "Mock Review" })]), "`studentOutputs[0]` has no valid id");
    assertProblem(
        entry([mockReviewOutput({ documentSchema: "student-result" })]),
        "`studentOutputs[0]` has no valid documentSchema"
    );
    assertProblem(entry([mockReviewOutput({ scopes: ["case"] })]), "declares no student scope");
    assertProblem(
        entry([mockReviewOutput({ scopes: ["response", "case"] })]),
        "`studentOutputs[0]` has scopes other than response and chat"
    );
    assertProblem(entry([mockReviewOutput({ label: " " })]), "`studentOutputs[0]` has no label and description");
    assertProblem(
        entry([mockReviewOutput({ scopes: ["response", "chat"] })]),
        "`studentOutputs[0]` uses scopes the adapter does not declare (chat)"
    );
    assertProblem(
        entry([mockReviewOutput(), mockReviewOutput()]),
        "`studentOutputs[1]` repeats the id mock-review"
    );
});

test("initialize: a production adapter that declares student outputs rejects the catalog", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-catalog-"));
    const manifestPath = path.join(directory, "manifest.json");

    try {
        await fs.writeFile(manifestPath, JSON.stringify({
            services: [productionEntry({ scopes: ["response"], studentOutputs: [mockReviewOutput()] })],
        }));
        const registry = new ExternalServicesRegistry({
            jobsService:   {},
            importAdapter: async () => assert.fail("nothing is imported from an invalid catalog"),
        });

        await assert.rejects(
            () => registry.initialize(manifestPath),
            /svc-production: `studentOutputs` is only for development adapters/
        );
        assert.equal(registry.initialized, false);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("registerService: a development adapter keeps its normalized student outputs", async () => {
    const registry = new ExternalServicesRegistry({
        jobsService:         {},
        developmentAdapters: true,
        importAdapter:       async () => ({ register: async () => {} }),
    });
    const originalInfo = console.info;
    console.info = () => {};
    try {
        await registry.registerService(
            developmentEntry({ scopes: ["response"], studentOutputs: [mockReviewOutput()] }),
            "/catalog/manifest.json"
        );
        await registry.registerService(
            { ...developmentEntry({ scopes: ["response"] }), id: "svc-silent" },
            "/catalog/manifest.json"
        );
    } finally {
        console.info = originalInfo;
    }

    assert.deepEqual(registry.services.get("svc-development").studentOutputs, [mockReviewOutput()]);
    assert.equal(registry.services.get("svc-silent").studentOutputs, null);
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

test("validateCatalogEntry: an adapter that lists report-building declares its column prefix", () => {
    assert.equal(REPORT_BUILDING_HOOK, "report-building");
    assert.deepEqual(validateCatalogEntry(productionEntry({
        hooks:  [REPORT_BUILDING_HOOK],
        report: { columnPrefix: "ats_" },
    })), []);
    assert.deepEqual(validateCatalogEntry(productionEntry({ report: { columnPrefix: "pa2_" } })), []);

    assertProblem(productionEntry({ hooks: [REPORT_BUILDING_HOOK] }), "needs `report.columnPrefix`");
    assertProblem(productionEntry({ report: "ats_" }), "`report` must be an object");
    assertProblem(productionEntry({ report: { columnPrefix: "ats_", label: "x" } }), "unknown keys (label)");
    for (const columnPrefix of ["ats", "Ats_", "_ats_", "ats-", "", 5]) {
        assertProblem(productionEntry({ report: { columnPrefix } }), "`report.columnPrefix` must be");
    }
});

test("validateCatalog: report column prefixes are unique", () => {
    const problems = validateCatalog({
        services: [
            productionEntry({ id: "svc-a", report: { columnPrefix: "ats_" } }),
            productionEntry({ id: "svc-b", report: { columnPrefix: "ats_" } }),
            productionEntry({ id: "svc-c", report: { columnPrefix: "pa_" } }),
            productionEntry({ id: "svc-d", report: { columnPrefix: "pax_" } }),
        ],
    });

    assert.deepEqual(problems, ["svc-b: `report.columnPrefix` ats_ is also declared by svc-a"]);
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
