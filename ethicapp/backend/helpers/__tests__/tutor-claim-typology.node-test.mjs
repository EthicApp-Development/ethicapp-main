import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../analysis-input-hash.js";
import {
    findQuestionTypology,
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

test("toTutorClaimTypology: maps claim-typology/v1 to tutor-claim-typology/v1 without relatedFacts", () => {
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

test("toTutorClaimTypology: no cited facts without an inventory", () => {
    const { typologies: [typology] } = typologyDocument();

    const withoutInventory = toTutorClaimTypology(typology, null);
    assert.ok(withoutInventory.types.every(type => !Object.hasOwn(type, "relatedEvidenceIds")));
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
