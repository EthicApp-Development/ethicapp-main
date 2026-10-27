import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../analysis-input-hash.js";
import {
    CLAIM_TYPOLOGY_SERVICE_ID,
    EVIDENCE_INVENTORY_SERVICE_ID,
    findQuestionTypology,
    loadTutorClaimTypology,
    MAX_TUTOR_CLAIM_TYPES,
    toTutorClaimTypology,
    TYPOLOGY_ABSENT_REASONS,
} from "../tutor-claim-typology.js";

const QUESTION_TEXT = "Should Sebastián tell his mother?";
const QUESTION = Object.freeze({
    id:       "p2-q1",
    text:     QUESTION_TEXT,
    textHash: sha256Text(QUESTION_TEXT),
});

function claimType(number, extra = {}) {
    return {
        id:          `AF${number}`,
        label:       `Type ${number}`,
        description: `Description ${number}`,
        stance:      "in_favor",
        ...extra,
    };
}

function typologyDocument(typology = {}) {
    return {
        schemaVersion: "claim-typology/v1",
        kind:          "design_claim_typology",
        language:      "en_US",
        typologies:    [{
            questionId:       "p2-q1",
            phaseId:          2,
            focalAction:      "tell his mother",
            questionTextHash: QUESTION.textHash,
            types:            [
                claimType(1, { exampleStatement: "I would tell her.", relatedEvidenceIds: ["EV2", "EV1"] }),
                claimType(2, { stance: "against", relatedEvidenceIds: ["EV1", "EV9"] }),
            ],
            ...typology,
        }],
    };
}

const INVENTORY = Object.freeze({
    schemaVersion: "evidence-inventory/v1",
    facts:         [
        { id: "EV1", statement: "His mother is ill." },
        { id: "EV2", statement: "He promised to help." },
        { id: "EV3", statement: "Not cited." },
    ],
});

test("findQuestionTypology: the question's typology when its hash matches the text", () => {
    const document = typologyDocument();

    assert.equal(findQuestionTypology(document, QUESTION).typology, document.typologies[0]);
    assert.equal(findQuestionTypology(document, QUESTION).reason, null);
});

test("findQuestionTypology: out of date, missing or foreign typologies give none", () => {
    const changed = { ...QUESTION, textHash: sha256Text("Another question?") };
    assert.deepEqual(findQuestionTypology(typologyDocument(), changed),
        { typology: null, reason: TYPOLOGY_ABSENT_REASONS.OUT_OF_DATE });
    assert.deepEqual(findQuestionTypology(typologyDocument({ questionTextHash: null }), QUESTION),
        { typology: null, reason: TYPOLOGY_ABSENT_REASONS.OUT_OF_DATE });
    assert.deepEqual(findQuestionTypology(typologyDocument(), { ...QUESTION, id: "p2-q2" }),
        { typology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_TYPOLOGY });
    for (const document of [null, {}, { schemaVersion: "mock-design-analysis/v1", typologies: [] }]) {
        assert.deepEqual(findQuestionTypology(document, QUESTION),
            { typology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_ANALYSIS });
    }
});

test("toTutorClaimTypology: maps claim-typology/v1 to tutor-claim-typology/v1 with the cited facts", () => {
    const { typologies: [typology] } = typologyDocument();

    assert.deepEqual(toTutorClaimTypology(typology, INVENTORY), {
        schemaVersion: "tutor-claim-typology/v1",
        focalAction:   "tell his mother",
        types:         [
            {
                id:                 "AF1",
                label:              "Type 1",
                description:        "Description 1",
                stance:             "in_favor",
                exampleStatement:   "I would tell her.",
                relatedEvidenceIds: ["EV2", "EV1"],
            },
            // EV9 is no longer in the inventory.
            {
                id:                 "AF2",
                label:              "Type 2",
                description:        "Description 2",
                stance:             "against",
                relatedEvidenceIds: ["EV1"],
            },
        ],
        // In order of first citation.
        relatedFacts: [
            { id: "EV2", statement: "He promised to help." },
            { id: "EV1", statement: "His mother is ill." },
        ],
    });
});

test("toTutorClaimTypology: sends only the keys tutor-claim-typology/v1 accepts", () => {
    const { typologies: [typology] } = typologyDocument();
    const mapped = toTutorClaimTypology(
        { ...typology, types: [claimType(1, { extra: "x" })] }, INVENTORY
    );

    assert.deepEqual(Object.keys(mapped).sort(), ["focalAction", "schemaVersion", "types"]);
    assert.deepEqual(Object.keys(mapped.types[0]).sort(),
        ["description", "id", "label", "stance"]);
});

test("toTutorClaimTypology: no cited facts without an inventory or citations", () => {
    const { typologies: [typology] } = typologyDocument();

    const withoutInventory = toTutorClaimTypology(typology, null);
    assert.equal(Object.hasOwn(withoutInventory, "relatedFacts"), false);
    assert.ok(withoutInventory.types.every(type => !Object.hasOwn(type, "relatedEvidenceIds")));
    assert.equal(Object.hasOwn(toTutorClaimTypology(
        { ...typology, types: [claimType(1)] }, INVENTORY
    ), "relatedFacts"), false);
});

test("toTutorClaimTypology: keeps at most eight usable types, and needs a focal action", () => {
    const types = [
        { id: "AF0" },
        claimType(1, { stance: "maybe" }),
        ...Array.from({ length: 10 }, (_, index) => claimType(index + 1)),
        claimType(1),
    ];
    const mapped = toTutorClaimTypology({ focalAction: "act", types });

    assert.equal(mapped.types.length, MAX_TUTOR_CLAIM_TYPES);
    assert.deepEqual(mapped.types.map(type => type.id),
        ["AF1", "AF2", "AF3", "AF4", "AF5", "AF6", "AF7", "AF8"]);
    assert.equal(mapped.types[0].stance, "in_favor", "a type with an unknown stance is left out");
    assert.equal(toTutorClaimTypology({ focalAction: " ", types }), null);
    assert.equal(toTutorClaimTypology({ focalAction: "act", types: [{ id: "AF1" }] }), null);
});

function fakeReads({ typologyRow, inventoryRow = { document: INVENTORY } }) {
    const reads = [];
    return {
        reads,
        dependencies: {
            getAnalysis: async args => {
                reads.push(args);
                return typologyRow;
            },
            getCaseAnalysisRow: async args => {
                reads.push(args);
                return inventoryRow;
            },
        },
    };
}

test("loadTutorClaimTypology: reads the design's typology and the case's inventory", async () => {
    const { reads, dependencies } = fakeReads({
        typologyRow: { status: "ready", document: typologyDocument() },
    });

    const result = await loadTutorClaimTypology(
        { designId: 12, caseId: 34, question: QUESTION }, dependencies
    );

    assert.equal(result.reason, null);
    assert.equal(result.claimTypology.focalAction, "tell his mother");
    assert.equal(result.claimTypology.relatedFacts.length, 2);
    assert.deepEqual(reads, [
        { designId: 12, serviceId: CLAIM_TYPOLOGY_SERVICE_ID },
        { caseId: 34, serviceId: EVIDENCE_INVENTORY_SERVICE_ID },
    ]);
});

test("loadTutorClaimTypology: no typology for a missing analysis, an out-of-date one or no question", async () => {
    const missing = fakeReads({ typologyRow: null });
    assert.deepEqual(
        await loadTutorClaimTypology({ designId: 12, caseId: 34, question: QUESTION },
            missing.dependencies),
        { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_ANALYSIS }
    );

    const outdated = fakeReads({
        typologyRow: { status: "ready", document: typologyDocument({ questionTextHash: "sha256:old" }) },
    });
    assert.deepEqual(
        await loadTutorClaimTypology({ designId: 12, caseId: 34, question: QUESTION },
            outdated.dependencies),
        { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.OUT_OF_DATE }
    );
    assert.equal(outdated.reads.length, 1, "no inventory is read for an out-of-date typology");

    const noQuestion = fakeReads({ typologyRow: null });
    assert.deepEqual(
        await loadTutorClaimTypology({ designId: 12, caseId: 34, question: null },
            noQuestion.dependencies),
        { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_QUESTION }
    );
    assert.deepEqual(noQuestion.reads, []);
});

test("loadTutorClaimTypology: types without citations read no inventory", async () => {
    const { reads, dependencies } = fakeReads({
        typologyRow: { status: "ready", document: typologyDocument({ types: [claimType(1)] }) },
    });

    const result = await loadTutorClaimTypology(
        { designId: 12, caseId: 34, question: QUESTION }, dependencies
    );

    assert.equal(result.claimTypology.types.length, 1);
    assert.equal(reads.length, 1);
});
