import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../analysis-input-hash.js";
import {
    decideTutorMode,
    expectedTutorModes,
    loadTutorModeInputs,
    TUTOR_CASE_CONTEXT_SCHEMA,
    TUTOR_MODE_REASONS,
} from "../tutor-mode.js";

const INVENTORY_ID = "case-analyst-evidence-inventory";
const TYPOLOGY_ID = "case-analyst-claim-typology";

const QUESTION_TEXT = "Should Sebastián tell his mother?";
const QUESTION = Object.freeze({
    id:       "p2-q1",
    text:     QUESTION_TEXT,
    textHash: sha256Text(QUESTION_TEXT),
});

const INVENTORY_DOCUMENT = Object.freeze({
    schemaVersion: "evidence-inventory/v1",
    kind:          "case_evidence_inventory",
    language:      "en_US",
    facts:         [{ id: "EV1", statement: "His mother is ill." }],
    exclusions:    [],
});

function typologyDocument(typologies = [typologyFor(QUESTION)]) {
    return { schemaVersion: "claim-typology/v1", typologies };
}

function typologyFor(question, extra = {}) {
    return {
        questionId:       question.id,
        phaseId:          2,
        focalAction:      "tell his mother",
        questionTextHash: question.textHash,
        types:            [{
            id:                 "AF1",
            label:              "Tell her",
            description:        "Argues for telling.",
            stance:             "in_favor",
            relatedEvidenceIds: ["EV1", "EV7"],
        }],
        ...extra,
    };
}

function row(status, document, extra = {}) {
    return { status, is_stale: false, document, ...extra };
}

function inputs({
    inventoryEnabled = true,
    typologyEnabled = true,
    inventory = row("ready", INVENTORY_DOCUMENT),
    typology = row("ready", typologyDocument()),
    inventoryLoadFailed = false,
    typologyLoadFailed = false,
} = {}) {
    return {
        inventory: {
            enabled:  inventoryEnabled,
            analysis: inventory,
            ...(inventoryLoadFailed ? { loadFailed: true } : {}),
        },
        typology: {
            enabled:  typologyEnabled,
            analysis: typology,
            ...(typologyLoadFailed ? { loadFailed: true } : {}),
        },
    };
}

const reasonOf = (options, question = QUESTION) => decideTutorMode(inputs(options), question).reason;

// ─── decideTutorMode ─────────────────────────────────────────────────────────

test("decideTutorMode: an inventory and a matching typology give the enhanced mode", () => {
    const decision = decideTutorMode(inputs(), QUESTION);

    assert.equal(decision.mode, "enhanced");
    assert.equal(decision.reason, null);
    assert.deepEqual(decision.caseContext, {
        schemaVersion:     TUTOR_CASE_CONTEXT_SCHEMA,
        evidenceInventory: INVENTORY_DOCUMENT,
        claimTypology:     {
            schemaVersion: "tutor-claim-typology/v1",
            focalAction:   "tell his mother",
            types:         [{
                id:                 "AF1",
                label:              "Tell her",
                description:        "Argues for telling.",
                stance:             "in_favor",
                relatedEvidenceIds: ["EV1"],
            }],
        },
    });
});

test("decideTutorMode: documents kept while a generation is in flight or after a failure are used", () => {
    for (const status of ["requested", "processing", "failed"]) {
        const decision = decideTutorMode(inputs({
            inventory: row(status, INVENTORY_DOCUMENT),
            typology:  row(status, typologyDocument()),
        }), QUESTION);
        assert.equal(decision.mode, "enhanced", status);
    }
});

test("decideTutorMode: every basic-mode reason", () => {
    const R = TUTOR_MODE_REASONS;
    const otherText = { ...QUESTION, textHash: sha256Text("Another question?") };
    const noTypologyForQuestion = typologyDocument([]);

    const cases = [
        [{ inventoryEnabled: false }, R.INVENTORY_DISABLED],
        [{ inventoryLoadFailed: true }, R.INVENTORY_FAILED],
        [{ inventory: row("failed", null) }, R.INVENTORY_FAILED],
        [{ inventory: row("processing", null, { is_stale: true }) }, R.INVENTORY_FAILED],
        [{ inventory: null }, R.NO_INVENTORY],
        [{ inventory: row("processing", null) }, R.NO_INVENTORY],
        [{ inventory: row("ready", { schemaVersion: "other/v1" }) }, R.NO_INVENTORY],
        [{ typologyEnabled: false }, R.TYPOLOGY_DISABLED],
        [{ typologyLoadFailed: true }, R.TYPOLOGY_FAILED],
        [{ typology: row("processing", noTypologyForQuestion) }, R.TYPOLOGY_PENDING],
        [{ typology: row("requested", null) }, R.TYPOLOGY_PENDING],
        [{ typology: row("failed", noTypologyForQuestion) }, R.TYPOLOGY_FAILED],
        [{ typology: row("requested", null, { is_stale: true }) }, R.TYPOLOGY_FAILED],
        [{ typology: row("ready", typologyDocument([typologyFor(QUESTION, { types: [] })])) },
            R.TYPOLOGY_FAILED],
        [{ typology: row("ready", typologyDocument([typologyFor(otherText)])) },
            R.TYPOLOGY_OUT_OF_DATE],
        [{ typology: row("ready", typologyDocument([typologyFor(QUESTION, { questionTextHash: null })])) },
            R.TYPOLOGY_OUT_OF_DATE],
        [{ typology: row("ready", noTypologyForQuestion) }, R.NO_TYPOLOGY],
        [{ typology: null }, R.NO_TYPOLOGY],
    ];

    for (const [options, reason] of cases) {
        const decision = decideTutorMode(inputs(options), QUESTION);
        assert.equal(decision.mode, "basic", JSON.stringify(options));
        assert.equal(decision.reason, reason, JSON.stringify(options));
        assert.equal(decision.caseContext, null);
    }

    assert.equal(reasonOf({}, null), R.NO_TYPOLOGY, "a response without a question unit");
});

test("decideTutorMode: the first reason that applies wins", () => {
    const R = TUTOR_MODE_REASONS;
    const outOfDate = typologyDocument([typologyFor({ ...QUESTION, textHash: "sha256:old" })]);

    assert.equal(reasonOf({ inventoryEnabled: false, typologyEnabled: false }), R.INVENTORY_DISABLED);
    assert.equal(reasonOf({ inventory: null, typologyEnabled: false }), R.NO_INVENTORY,
        "the inventory comes before the typology");
    assert.equal(reasonOf({ inventory: row("failed", null), typology: null }), R.INVENTORY_FAILED);
    assert.equal(reasonOf({ typologyEnabled: false, typology: row("processing", null) }),
        R.TYPOLOGY_DISABLED);
    assert.equal(reasonOf({ typology: row("processing", outOfDate) }), R.TYPOLOGY_PENDING,
        "an out-of-date typology being regenerated is pending");
    assert.equal(reasonOf({ typology: row("failed", outOfDate) }), R.TYPOLOGY_FAILED,
        "an out-of-date typology whose regeneration failed is failed");
    assert.equal(reasonOf({ typology: row("ready", outOfDate) }), R.TYPOLOGY_OUT_OF_DATE);
});

test("decideTutorMode: no inputs at all is basic", () => {
    assert.equal(decideTutorMode().mode, "basic");
    assert.equal(decideTutorMode().reason, TUTOR_MODE_REASONS.INVENTORY_DISABLED);
});

// ─── loadTutorModeInputs ─────────────────────────────────────────────────────

function fakeRegistry(usable = [INVENTORY_ID, TYPOLOGY_ID]) {
    const calls = [];
    return {
        calls,
        async getSessionPolicyVersion(sessionId) {
            calls.push({ pinned: sessionId });
            return { id: 9 };
        },
        async usableServiceIds(serviceIds, options) {
            calls.push({ serviceIds, options });
            return serviceIds.filter(id => usable.includes(id));
        },
    };
}

function fakeReads({ inventoryRow = row("ready", INVENTORY_DOCUMENT), typologyRow = row("ready", typologyDocument()) } = {}) {
    const reads = [];
    return {
        reads,
        getCaseAnalysisRow: async (args) => {
            reads.push(args);
            if (inventoryRow instanceof Error) {
                throw inventoryRow;
            }
            return inventoryRow;
        },
        getDesignAnalysisRow: async (args) => {
            reads.push(args);
            return typologyRow;
        },
    };
}

test("loadTutorModeInputs: reads both analyses under the current policy", async () => {
    const registry = fakeRegistry();
    const reads = fakeReads();

    const loaded = await loadTutorModeInputs({ caseId: 34, designId: 12 }, { registry, ...reads });

    assert.equal(loaded.inventory.enabled, true);
    assert.equal(loaded.inventory.analysis.document, INVENTORY_DOCUMENT);
    assert.equal(loaded.typology.enabled, true);
    assert.deepEqual(registry.calls, [{ serviceIds: [INVENTORY_ID, TYPOLOGY_ID], options: {} }]);
    assert.deepEqual(reads.reads, [
        { caseId: 34, serviceId: INVENTORY_ID },
        { designId: 12, serviceId: TYPOLOGY_ID },
    ]);
});

test("loadTutorModeInputs: a session follows its pinned policy version", async () => {
    const registry = fakeRegistry();

    await loadTutorModeInputs({ caseId: 34, designId: 12, sessionId: 5 }, { registry, ...fakeReads() });

    assert.deepEqual(registry.calls, [
        { pinned: 5 },
        { serviceIds: [INVENTORY_ID, TYPOLOGY_ID], options: { policyVersion: { id: 9 } } },
    ]);
});

test("loadTutorModeInputs: a switched-off adapter is not read; a failed read is recorded", async () => {
    const reads = fakeReads({ inventoryRow: new Error("db down") });
    const originalWarn = console.warn;
    console.warn = () => {};
    let loaded;
    try {
        loaded = await loadTutorModeInputs(
            { caseId: 34, designId: 12 },
            { registry: fakeRegistry([INVENTORY_ID]), ...reads }
        );
    } finally {
        console.warn = originalWarn;
    }

    assert.deepEqual(loaded.inventory, { enabled: true, analysis: null, loadFailed: true });
    assert.deepEqual(loaded.typology, { enabled: false, analysis: null });
    assert.deepEqual(reads.reads, [{ caseId: 34, serviceId: INVENTORY_ID }]);
    assert.equal(decideTutorMode(loaded, QUESTION).reason, TUTOR_MODE_REASONS.INVENTORY_FAILED);
});

test("loadTutorModeInputs: no case or no design reads nothing", async () => {
    const reads = fakeReads();
    const loaded = await loadTutorModeInputs(
        { caseId: null, designId: 0 },
        { registry: fakeRegistry(), ...reads }
    );

    assert.deepEqual(reads.reads, []);
    assert.equal(decideTutorMode(loaded, QUESTION).reason, TUTOR_MODE_REASONS.NO_INVENTORY);
});

// ─── expectedTutorModes ──────────────────────────────────────────────────────

test("expectedTutorModes: the mode each question would get now, by unit id", async () => {
    const changed = { id: "p2-q2", textHash: sha256Text("What now?") };
    const reads = fakeReads({
        typologyRow: row("ready", typologyDocument([
            typologyFor(QUESTION),
            typologyFor({ ...changed, textHash: "sha256:old" }),
        ])),
    });

    const modes = await expectedTutorModes(
        { units: [QUESTION, changed], caseId: 34, designId: 12 },
        { registry: fakeRegistry(), ...reads }
    );

    assert.deepEqual(modes, {
        "p2-q1": { mode: "enhanced", reason: null },
        "p2-q2": { mode: "basic", reason: "typology-out-of-date" },
    });
    assert.equal(reads.reads.length, 2, "the analyses are read once for every question");
});

test("expectedTutorModes: no units reads nothing", async () => {
    const registry = fakeRegistry();
    assert.deepEqual(await expectedTutorModes({ units: [], caseId: 34, designId: 12 }, { registry }), {});
    assert.deepEqual(registry.calls, []);
});
