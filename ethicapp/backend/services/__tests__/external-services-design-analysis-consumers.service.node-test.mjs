import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { needsDesignAnalysis as tutorNeedsDesignAnalysis } from "../../external-services/adapters/ats-feedback.adapter.js";
import { designAnalysisInput } from "../../external-services/adapters/case-analyst-claim-typology.adapter.js";
import {
    explainDesignAnalysisUnits,
    selectDesignAnalysisUnits,
    selectQuestionUnits,
} from "../../helpers/design-analysis-units.js";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { captureWarnings } from "./capture-warnings.mjs";

// Consumer-driven selection of design analysis units (#863, epic #861). The
// claim typology produces claim-typology/v1 per question; the adapters that
// consume it decide which questions it covers: those of the phases that
// enable a consumer the policy allows. The registry is built from the shipped
// catalog, or from it plus test consumers, with stub adapter modules.

const SHIPPED_MANIFEST_PATH = fileURLToPath(
    new URL("../../external-services/manifest.json", import.meta.url)
);
const SHIPPED_MANIFEST = JSON.parse(await fs.readFile(SHIPPED_MANIFEST_PATH, "utf8"));

const CLAIM_TYPOLOGY = "case-analyst-claim-typology";
const TUTOR = "argumentation-tutor-system";
const TEST_CONSUMER = "test-typology-consumer";
const TEST_DEV_CONSUMER = "test-dev-typology-consumer";
const ALL_SERVICES = Object.freeze(["case-analyst", "argumentation-tutor", "polyadic-agent"]);
const CONSUMES_TYPOLOGIES = Object.freeze([{ documentSchema: "claim-typology/v1", unit: "question" }]);

// A production consumer of claim typologies that requires polyadic-agent, and
// a development one.
const TEST_CONSUMERS = [
    {
        id:           TEST_CONSUMER,
        adapter:      "./adapters/test-consumer.adapter.js",
        requires:     ["polyadic-agent"],
        hooks:        ["student-response-submitted"],
        scopes:       ["response"],
        consumes:     CONSUMES_TYPOLOGIES,
        callbackAuth: { allowedClientIds: ["test-client"], requiredRoles: [] },
    },
    {
        id:           TEST_DEV_CONSUMER,
        adapter:      "./adapters/test-dev-consumer.adapter.js",
        development:  true,
        requires:     [],
        hooks:        ["student-response-submitted"],
        scopes:       ["response"],
        consumes:     CONSUMES_TYPOLOGIES,
        callbackAuth: { allowedClientIds: ["test-client"], requiredRoles: [] },
    },
];

const DESIGN_CASE = { id: 57, title: "The report data", languageCode: "es_CL", contentHash: "sha256:pdf" };

function phase(enabledServiceIds, texts) {
    return {
        externalServices: { enabledServiceIds },
        questions:        texts.map(q_text => ({ q_text })),
    };
}

// Phase 1 uses the tutor, phase 2 the test consumer, phase 3 both, phase 4
// the development consumer and phase 5 nothing.
const DESIGN = {
    type:   "semantic_differential",
    valid:  true,
    phases: [
        phase([TUTOR], ["Should Camila omit the data?"]),
        phase([TEST_CONSUMER], ["Who is affected?"]),
        phase([TUTOR, TEST_CONSUMER], ["Is the request acceptable?"]),
        phase([TEST_DEV_CONSUMER], ["What would you do?"]),
        phase([], ["Not analysed."]),
    ],
};

function selectedIds(units) {
    return units.map(unit => unit.id);
}

function makePolicy(policyVersion) {
    const policy = {
        reads: 0,
        async getCurrentPolicyVersion() {
            policy.reads += 1;
            return policyVersion;
        },
        async getPolicyVersion() {
            return policyVersion;
        },
        async getSessionPolicyVersionId() {
            return null;
        },
    };
    return policy;
}

function policyVersion({ allowed = ALL_SERVICES, disabled = [] } = {}) {
    return Object.freeze({ id: 1, allowedServiceIds: allowed, disabledAdapterIds: disabled });
}

async function writeManifest(services) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-consumers-"));
    const manifestPath = path.join(directory, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify({ services }));
    return { directory, manifestPath };
}

async function makeRegistry({
    version = policyVersion(),
    manifestServices = SHIPPED_MANIFEST.services,
    developmentAdapters = false,
    connected = true,
} = {}) {
    const policy = makePolicy(version);
    const registry = new ExternalServicesRegistry({
        developmentAdapters,
        aiServicePolicy:         policy,
        isAiAdditionsConfigured: async () => connected,
        // Stub modules, except that the tutor's carries its real
        // needsDesignAnalysis() (#870).
        importAdapter:           async href => ({
            register:            async () => {},
            getUiTranslations:   async () => null,
            designAnalysisInput: async () => null,
            ...(href.endsWith("/ats-feedback.adapter.js")
                ? { needsDesignAnalysis: tutorNeedsDesignAnalysis }
                : {}),
        }),
        jobsService: {},
    });

    const { directory, manifestPath } = await writeManifest(manifestServices);
    try {
        const { warnings } = await captureWarnings(() => {
            const originalInfo = console.info;
            console.info = () => {};
            return registry.initialize(manifestPath).finally(() => { console.info = originalInfo; });
        });
        return { registry, policy, warnings };
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

function withTestConsumers() {
    return [...SHIPPED_MANIFEST.services, ...TEST_CONSUMERS];
}

function selectFor(registry, design = DESIGN) {
    return selectDesignAnalysisUnits({ producerId: CLAIM_TYPOLOGY, design }, { registry });
}

// ─── The shipped catalog: the tutor is the consumer ──────────────────────────

test("shipped catalog: the claim typology is produced per question and the tutor consumes it", async () => {
    const { registry, warnings } = await makeRegistry();

    assert.deepEqual(registry.getDesignAnalysisConsumerIds(CLAIM_TYPOLOGY), [TUTOR]);
    assert.deepEqual(registry.getDesignAnalysisConsumerIds(CLAIM_TYPOLOGY, { unit: "phase" }), []);
    assert.deepEqual(registry.getDesignAnalysisConsumerIds(TUTOR), [], "the tutor produces nothing");
    assert.deepEqual(registry.getDesignAnalysisConsumerIds("unknown"), []);
    assert.deepEqual(warnings, [], "every consumption of the shipped catalog has a producer");
});

test("shipped catalog: the selection is the questions of the tutor's phases, as before #863", async () => {
    const { registry } = await makeRegistry();

    const selected = await selectFor(registry);

    assert.deepEqual(selectedIds(selected), ["p1-q1", "p3-q1"]);
    assert.deepEqual(selected, selectQuestionUnits(DESIGN, { serviceIds: [TUTOR] }));
});

test("shipped catalog: the claim typology input hash is unchanged by #863", async () => {
    const { registry } = await makeRegistry();
    const tutorPhase = { externalServices: { enabledServiceIds: [TUTOR] } };
    const design = {
        type:   "semantic_differential",
        valid:  true,
        phases: [
            { ...tutorPhase, questions: [{ q_text: "Should Camila omit the data?" }, { q_text: " " }, { q_text: "Why?" }] },
            { questions: [{ q_text: "Not discussed with the tutor." }] },
            { ...tutorPhase, questions: [{ q_text: "**Is** the request acceptable?", q_text_content_type: "text/markdown" }] },
        ],
    };

    const { hash } = await designAnalysisInput(
        { design, designCase: DESIGN_CASE },
        { registry, getAnalysis: async () => null }
    );

    // Computed with selectTutorQuestions() before #863, for the same fixture.
    assert.equal(hash, "sha256:ca11c9ef0d5ec6dfb02c4e984585c93fa22d3d7a50db27c4f1d87fdb235f3894");
});

test("shipped catalog: switching the tutor off removes its phases", async () => {
    const service = await makeRegistry({ version: policyVersion({ allowed: ["case-analyst"] }) });
    assert.deepEqual(await selectFor(service.registry), []);

    const adapter = await makeRegistry({ version: policyVersion({ disabled: [TUTOR] }) });
    assert.deepEqual(await selectFor(adapter.registry), []);
    assert.equal(
        await designAnalysisInput({ design: DESIGN, designCase: DESIGN_CASE }, {
            registry:    adapter.registry,
            getAnalysis: async () => assert.fail("nothing is read without a usable consumer"),
        }),
        null
    );

    const offline = await makeRegistry({ connected: false });
    assert.deepEqual(await selectFor(offline.registry), [], "a production consumer needs the connection");
});

test("shipped catalog: the policy is read only when a phase enables a consumer", async () => {
    const { registry, policy } = await makeRegistry();
    const reads = policy.reads;

    assert.deepEqual(await selectFor(registry, {
        type:   "semantic_differential",
        phases: [phase([], ["No consumer here."]), phase(["polyadic-devils-advocate"], ["Nor here."])],
    }), []);
    assert.deepEqual(await selectFor(registry, { ...DESIGN, type: "ranking" }), []);
    assert.deepEqual(await selectFor(registry, null), []);
    assert.equal(policy.reads, reads);

    await selectFor(registry);
    assert.equal(policy.reads, reads + 1);
});

// ─── A test consumer added to the catalog ────────────────────────────────────

test("test consumer: its phases are selected too", async () => {
    const { registry } = await makeRegistry({ manifestServices: withTestConsumers() });

    assert.deepEqual(registry.getDesignAnalysisConsumerIds(CLAIM_TYPOLOGY), [TUTOR, TEST_CONSUMER],
        "the development consumer is not registered");
    assert.deepEqual(selectedIds(await selectFor(registry)), ["p1-q1", "p2-q1", "p3-q1"]);

    const { input } = await designAnalysisInput(
        { design: DESIGN, designCase: DESIGN_CASE },
        { registry, getAnalysis: async () => null }
    );
    assert.deepEqual(selectedIds(input.questions), ["p1-q1", "p2-q1", "p3-q1"]);
});

test("test consumer: a development consumer counts when development adapters are on", async () => {
    const { registry } = await makeRegistry({
        manifestServices:    withTestConsumers(),
        developmentAdapters: true,
    });

    assert.deepEqual(selectedIds(await selectFor(registry)), ["p1-q1", "p2-q1", "p3-q1", "p4-q1"]);
});

test("test consumer: switching it off through the policy removes its phases", async () => {
    // Its AI Additions service is not allowed.
    const service = await makeRegistry({
        manifestServices: withTestConsumers(),
        version:          policyVersion({ allowed: ["case-analyst", "argumentation-tutor"] }),
    });
    assert.deepEqual(selectedIds(await selectFor(service.registry)), ["p1-q1", "p3-q1"]);

    // Its own per-adapter switch (#864).
    const adapter = await makeRegistry({
        manifestServices: withTestConsumers(),
        version:          policyVersion({ disabled: [TEST_CONSUMER] }),
    });
    assert.deepEqual(selectedIds(await selectFor(adapter.registry)), ["p1-q1", "p3-q1"]);
});

test("test consumer: a phase stays selected while one of its consumers is usable", async () => {
    const { registry } = await makeRegistry({
        manifestServices: withTestConsumers(),
        version:          policyVersion({ disabled: [TUTOR] }),
    });

    // Phase 3 enables the switched-off tutor and the usable test consumer.
    assert.deepEqual(selectedIds(await selectFor(registry)), ["p2-q1", "p3-q1"]);
});

// ─── The tutor's requested mode (#870) ───────────────────────────────────────

function tutorPhase(evaluationMode, texts, enabledServiceIds = [TUTOR]) {
    return {
        externalServices: {
            enabledServiceIds,
            ...(evaluationMode
                ? { configurations: { [TUTOR]: { evaluation_mode: evaluationMode } } }
                : {}),
        },
        questions: texts.map(q_text => ({ q_text })),
    };
}

// The fixture of the pinned hash, with the tutor's phases configured.
function pinnedDesign(evaluationMode) {
    return {
        type:   "semantic_differential",
        valid:  true,
        phases: [
            {
                ...tutorPhase(evaluationMode, []),
                questions: [{ q_text: "Should Camila omit the data?" }, { q_text: " " }, { q_text: "Why?" }],
            },
            { questions: [{ q_text: "Not discussed with the tutor." }] },
            {
                ...tutorPhase(evaluationMode, []),
                questions: [{ q_text: "**Is** the request acceptable?", q_text_content_type: "text/markdown" }],
            },
        ],
    };
}

const PINNED_HASH = "sha256:ca11c9ef0d5ec6dfb02c4e984585c93fa22d3d7a50db27c4f1d87fdb235f3894";

async function typologyInput(registry, design) {
    return designAnalysisInput({ design, designCase: DESIGN_CASE }, { registry, getAnalysis: async () => null });
}

test("tutor mode: the registry asks the tutor's adapter whether a phase needs the typology", async () => {
    const { registry } = await makeRegistry();
    const needs = configuration => registry.consumerNeedsDesignAnalysis(TUTOR, {
        producerId: CLAIM_TYPOLOGY, configuration,
    });

    assert.equal(needs({ evaluation_mode: "basic" }), false);
    assert.equal(needs({ evaluation_mode: "enhanced" }), true);
    assert.equal(needs({}), true, "no stored value is the enhanced default");
    assert.equal(registry.consumerNeedsDesignAnalysis(TUTOR, { producerId: CLAIM_TYPOLOGY }), true);
    assert.equal(registry.consumerNeedsDesignAnalysis("polyadic-devils-advocate", {
        producerId: CLAIM_TYPOLOGY, configuration: { evaluation_mode: "basic" },
    }), true, "an adapter without needsDesignAnalysis() needs every phase");
});

test("tutor mode: the pinned hash holds with no stored mode and with an explicit enhanced", async () => {
    const { registry } = await makeRegistry();

    assert.equal((await typologyInput(registry, pinnedDesign(null))).hash, PINNED_HASH);
    assert.equal((await typologyInput(registry, pinnedDesign("enhanced"))).hash, PINNED_HASH,
        "an explicit enhanced selects the same questions");
});

test("tutor mode: a basic and an enhanced phase get a typology for the enhanced one only", async () => {
    const { registry } = await makeRegistry();
    const mixed = {
        type:   "semantic_differential",
        valid:  true,
        phases: [
            tutorPhase("basic", ["Should Camila omit the data?"]),
            tutorPhase("enhanced", ["Is the request acceptable?"]),
        ],
    };

    const { input, hash } = await typologyInput(registry, mixed);
    assert.deepEqual(selectedIds(input.questions), ["p2-q1"]);

    // Switching the basic phase to enhanced requests its questions, and the
    // input hash follows; switching back restores it.
    const switched = structuredClone(mixed);
    switched.phases[0].externalServices.configurations[TUTOR].evaluation_mode = "enhanced";
    const after = await typologyInput(registry, switched);
    assert.deepEqual(selectedIds(after.input.questions), ["p1-q1", "p2-q1"]);
    assert.notEqual(after.hash, hash);
    assert.equal((await typologyInput(registry, structuredClone(mixed))).hash, hash);
});

test("tutor mode: a design whose tutor phases are all basic gets no typology, and says why", async () => {
    const { registry } = await makeRegistry();
    const allBasic = {
        type:   "semantic_differential",
        valid:  true,
        phases: [tutorPhase("basic", ["Should Camila omit the data?"])],
    };

    assert.equal(await typologyInput(registry, allBasic), null);
    const explained = await explainDesignAnalysisUnits({ producerId: CLAIM_TYPOLOGY, design: allBasic }, { registry });
    assert.equal(explained.reason, "not-needed");
    assert.deepEqual(explained.consumerIds, [TUTOR], "the tutor is still a usable consumer");
});

test("tutor mode: a basic tutor phase stays selected for another consumer that needs it", async () => {
    const { registry } = await makeRegistry({ manifestServices: withTestConsumers() });
    const design = {
        type:   "semantic_differential",
        valid:  true,
        phases: [
            tutorPhase("basic", ["Tutor only?"]),
            tutorPhase("basic", ["Both?"], [TUTOR, TEST_CONSUMER]),
        ],
    };

    assert.deepEqual(selectedIds(await selectFor(registry, design)), ["p2-q1"]);
});

// ─── Catalog warnings ────────────────────────────────────────────────────────

test("catalog: a consumption without a producer is logged as a warning, not refused", async () => {
    const orphan = {
        ...TEST_CONSUMERS[0],
        consumes: [{ documentSchema: "argument-map/v1", unit: "question" }],
    };
    const { registry, warnings } = await makeRegistry({
        manifestServices: [...SHIPPED_MANIFEST.services, orphan],
    });

    assert.equal(registry.initialized, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /test-typology-consumer: consumes argument-map\/v1 per question, which no adapter/);
    assert.deepEqual(registry.getDesignAnalysisConsumerIds(CLAIM_TYPOLOGY), [TUTOR]);
});
