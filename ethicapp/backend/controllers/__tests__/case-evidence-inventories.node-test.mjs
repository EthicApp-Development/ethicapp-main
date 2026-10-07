import assert from "node:assert/strict";
import test from "node:test";
import {
    generateEvidenceInventoryForOwner,
    getEvidenceInventoryForOwner,
    saveEvidenceInventoryForOwner,
} from "../case-evidence-inventories.js";

const OWNED_CASE = { id: 7, language_code: "es_CL", render_status: "completed" };

const STORED_INVENTORY = {
    schemaVersion: "evidence-inventory/v1",
    kind:          "case_evidence_inventory",
    language:      "es_CL",
    facts:         [{
        id:               "EV1",
        group:            "Familia",
        label:            "padres trabajan",
        statement:        "Ambos padres trabajan.",
        sourceQuote:      "ambos papás trabajan",
        sourceQuoteFound: true,
        countingNote:     null,
    }],
    exclusions: [],
};

function inventoryRow(overrides = {}) {
    return {
        case_id:       7,
        status:        "draft",
        inventory:     STORED_INVENTORY,
        error_message: null,
        generated_at:  "2026-10-04T12:00:00.000Z",
        reviewed_at:   null,
        updated_at:    "2026-10-04T12:00:00.000Z",
        is_stale:      false,
        ...overrides,
    };
}

function createDependencies(overrides = {}) {
    const calls = { saveReviewed: [], dispatch: [] };
    const dependencies = {
        getOwnedCase:     async () => OWNED_CASE,
        getInventory:     async () => inventoryRow(),
        saveReviewed:     async args => {
            calls.saveReviewed.push(args);
            return inventoryRow({ status: "reviewed", inventory: args.inventory });
        },
        getCaseText:      async () => "12   Ellos son una familia esforzada: ambos papás\n13   trabajan.",
        isServiceEnabled: () => true,
        dispatch:         async caseId => {
            calls.dispatch.push(caseId);
        },
        ...overrides,
    };
    return { dependencies, calls };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

test("getEvidenceInventoryForOwner returns the inventory state", async () => {
    const { dependencies } = createDependencies();

    const response = await getEvidenceInventoryForOwner({ caseId: 7, userId: 42, dependencies });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.result, {
        caseId:         7,
        serviceEnabled: true,
        documentStatus: "completed",
        documentReady:  true,
        status:         "draft",
        stale:          false,
        inventory:      STORED_INVENTORY,
        errorMessage:   null,
        generatedAt:    "2026-10-04T12:00:00.000Z",
        reviewedAt:     null,
        updatedAt:      "2026-10-04T12:00:00.000Z",
    });
});

test("getEvidenceInventoryForOwner reports cases without inventory", async () => {
    const { dependencies } = createDependencies({ getInventory: async () => null });

    const response = await getEvidenceInventoryForOwner({ caseId: 7, userId: 42, dependencies });

    assert.equal(response.body.result.status, "none");
    assert.equal(response.body.result.inventory, null);
});

test("getEvidenceInventoryForOwner reports cases whose document was never rendered", async () => {
    const { dependencies } = createDependencies({
        getOwnedCase: async () => ({ ...OWNED_CASE, render_status: null }),
    });

    const response = await getEvidenceInventoryForOwner({ caseId: 7, userId: 42, dependencies });

    assert.equal(response.body.result.documentStatus, null);
    assert.equal(response.body.result.documentReady, false);
});

test("inventory endpoints hide cases the teacher does not own", async () => {
    const { dependencies, calls } = createDependencies({ getOwnedCase: async () => null });

    for (const handler of [
        getEvidenceInventoryForOwner,
        saveEvidenceInventoryForOwner,
        generateEvidenceInventoryForOwner,
    ]) {
        const response = await handler({ caseId: 7, userId: 99, inventory: STORED_INVENTORY, dependencies });
        assert.equal(response.status, 404);
        assert.equal(response.body.code, "CASE_NOT_FOUND");
    }
    assert.equal(calls.saveReviewed.length, 0);
    assert.equal(calls.dispatch.length, 0);
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

test("saveEvidenceInventoryForOwner stores the reviewed inventory with checked quotes", async () => {
    const { dependencies, calls } = createDependencies();
    const edited = {
        ...STORED_INVENTORY,
        facts: [
            STORED_INVENTORY.facts[0],
            { group: "Familia", label: "", statement: "Nuevo hecho.", sourceQuote: "no está", countingNote: "" },
        ],
    };

    const response = await saveEvidenceInventoryForOwner({ caseId: 7, userId: 42, inventory: edited, dependencies });

    assert.equal(response.status, 200);
    assert.equal(response.body.result.status, "reviewed");
    const saved = calls.saveReviewed[0];
    assert.equal(saved.caseId, 7);
    assert.equal(saved.userId, 42);
    assert.deepEqual(
        saved.inventory.facts.map(fact => [fact.id, fact.sourceQuoteFound]),
        [["EV1", true], ["EV2", false]]
    );
});

test("saveEvidenceInventoryForOwner saves a hand-made inventory when the case has no text", async () => {
    const { dependencies, calls } = createDependencies({
        getOwnedCase: async () => ({ ...OWNED_CASE, render_status: "failed" }),
        getCaseText:  async () => {
            throw new Error("ENOENT: representation.json");
        },
    });

    const response = await saveEvidenceInventoryForOwner({
        caseId:    7,
        userId:    42,
        inventory: { facts: [{ statement: "Hecho escrito a mano.", sourceQuote: "una cita" }], exclusions: [] },
        dependencies,
    });

    assert.equal(response.status, 200);
    assert.equal(calls.saveReviewed[0].inventory.facts[0].sourceQuoteFound, false);
});

test("saveEvidenceInventoryForOwner rejects invalid inventories", async () => {
    const { dependencies, calls } = createDependencies();

    const response = await saveEvidenceInventoryForOwner({
        caseId:    7,
        userId:    42,
        inventory: { facts: [{ statement: "" }], exclusions: [] },
        dependencies,
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.code, "EVIDENCE_INVENTORY_INVALID");
    assert.deepEqual(response.body.details, ["facts[0].statement is required"]);
    assert.equal(calls.saveReviewed.length, 0);
});

test("saveEvidenceInventoryForOwner refuses edits while a generation runs", async () => {
    const { dependencies } = createDependencies({ saveReviewed: async () => null });

    const response = await saveEvidenceInventoryForOwner({
        caseId:    7,
        userId:    42,
        inventory: STORED_INVENTORY,
        dependencies,
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "EVIDENCE_INVENTORY_PROCESSING");
});

// ─── POST generate ────────────────────────────────────────────────────────────

test("generateEvidenceInventoryForOwner dispatches the case hook", async () => {
    const states = [inventoryRow({ status: "reviewed" }), inventoryRow({ status: "processing" })];
    const { dependencies, calls } = createDependencies({ getInventory: async () => states.shift() });

    const response = await generateEvidenceInventoryForOwner({ caseId: 7, userId: 42, dependencies });

    assert.equal(response.status, 202);
    assert.equal(response.body.result.status, "processing");
    assert.deepEqual(calls.dispatch, [7]);
});

test("generateEvidenceInventoryForOwner allows retrying a stale generation", async () => {
    const { dependencies, calls } = createDependencies({
        getInventory: async () => inventoryRow({ status: "processing", is_stale: true }),
    });

    const response = await generateEvidenceInventoryForOwner({ caseId: 7, userId: 42, dependencies });

    assert.equal(response.status, 202);
    assert.deepEqual(calls.dispatch, [7]);
});

test("generateEvidenceInventoryForOwner rejects requests that cannot run", async () => {
    const scenarios = [
        [{ isServiceEnabled: () => false }, 503, "EVIDENCE_INVENTORY_SERVICE_DISABLED"],
        [{ getOwnedCase: async () => ({ ...OWNED_CASE, render_status: "processing" }) }, 409, "CASE_DOCUMENT_NOT_READY"],
        [{ getInventory: async () => inventoryRow({ status: "processing" }) }, 409, "EVIDENCE_INVENTORY_PROCESSING"],
    ];

    for (const [overrides, expectedStatus, expectedCode] of scenarios) {
        const { dependencies, calls } = createDependencies(overrides);

        const response = await generateEvidenceInventoryForOwner({ caseId: 7, userId: 42, dependencies });

        assert.equal(response.status, expectedStatus, expectedCode);
        assert.equal(response.body.code, expectedCode);
        assert.equal(calls.dispatch.length, 0);
    }
});
