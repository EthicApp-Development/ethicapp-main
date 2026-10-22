import assert from "node:assert/strict";
import test from "node:test";
import {
    EvidenceInventoryValidationError,
    MAX_EXCLUSIONS,
    MAX_FACTS,
    isQuoteFound,
    normalizeEvidenceInventory,
    prepareCaseText,
} from "../evidence-inventory-document.js";

function fact(overrides = {}) {
    return {
        id:               "EV1",
        group:            "Familia",
        label:            "padres trabajan",
        statement:        "Ambos padres trabajan.",
        sourceQuote:      "ambos papás trabajan",
        sourceQuoteFound: true,
        countingNote:     null,
        ...overrides,
    };
}

function exclusion(overrides = {}) {
    return {
        id:        "EX1",
        label:     "becas",
        statement: "Que existen becas.",
        reason:    "El caso no lo dice.",
        ...overrides,
    };
}

function inventory(overrides = {}) {
    return {
        schemaVersion: "evidence-inventory/v1",
        kind:          "case_evidence_inventory",
        language:      "es_CL",
        facts:         [fact()],
        exclusions:    [exclusion()],
        ...overrides,
    };
}

// ─── Quote normalization ──────────────────────────────────────────────────────
// Same cases as the Argumentation Tutor
// (argumentation-tutor/backend/tests/test_evidence_inventory_task.py).

const QUOTE_CASES = [
    ["me llamó Sebastián, mi mejor\n6    amigo, para", "Sebastián, mi mejor amigo", true],
    ["es la ense-\n12   ñanza del curso", "la enseñanza del curso", true],
    ["dijo: “en esta familia” y ‘nada’", "dijo: \"en esta familia\" y 'nada'", true],
    ["Hola   Mundo\tcruel", "hola mundo cruel", true],
    ["Después de todo,\f1    Sebastián me había", "Después de todo, Sebastián me había", true],
    ["la canción", "la canción", true],
    ["un año — o dos", "un año - o dos", true],
    ["las recaídas-\nfue de 15,6", "las recaídas- fue de 15,6", true],
    ["el plazo vencía el\n15 de marzo", "vencía el 15 de marzo", true],
    [
        "su muerte. Si se utiliza un\n\n1\n  Caso elaborado por la unidad.\n\falgoritmo menos exacto en la población",
        "Si se utiliza un algoritmo menos exacto en la población",
        true,
    ],
    [
        `Si se utiliza un\n${"nota al pie. ".repeat(300)}\falgoritmo menos exacto en la población`,
        "Si se utiliza un algoritmo menos exacto en la población",
        false,
    ],
    [
        "Si se utiliza un\nnota al pie sin salto de página.\nalgoritmo menos exacto en la población",
        "Si se utiliza un algoritmo menos exacto en la población",
        false,
    ],
    [
        "Sebastián le dijo a su papá que no quería copiar en el examen",
        "le dijo a su papá que quería copiar en el examen",
        false,
    ],
    [
        "algoritmo menos exacto en la población.\fSi se utiliza un",
        "Si se utiliza un algoritmo menos exacto en la población",
        false,
    ],
    ["Sebastián estudió harto", "Sebastián es un buen estudiante", false],
    ["Sebastián estudió harto", "", false],
    ["Sebastián estudió harto", null, false],
];

test("isQuoteFound tolerates PDF extraction artifacts", () => {
    for (const [caseText, quote, expected] of QUOTE_CASES) {
        assert.equal(
            isQuoteFound(quote, prepareCaseText(caseText)),
            expected,
            `quote ${JSON.stringify(quote)} in ${JSON.stringify(caseText)}`
        );
    }
});

test("isQuoteFound stays fast on long repetitive case texts", () => {
    const caseText = "la familia de Sebastián estudia contabilidad y ".repeat(4300).slice(0, 200000);
    const prepared = prepareCaseText(caseText);
    const quote = "la familia de Sebastián estudia contabilidad y además nunca copia en los exámenes";

    const startedAt = Date.now();
    for (let index = 0; index < 60; index += 1) {
        assert.equal(isQuoteFound(quote, prepared), false);
    }

    assert.ok(Date.now() - startedAt < 10000, "60 quote checks must not block the server");
});

// ─── normalizeEvidenceInventory ───────────────────────────────────────────────

test("normalizeEvidenceInventory keeps a valid generated draft", () => {
    const generated = inventory({
        generation: {
            model:         "gpt-5-mini",
            promptVersion: "evidence-inventory-prompt/v1",
            generatedAt:   "2026-10-04T12:00:00Z",
        },
        unexpected: "dropped",
    });

    const normalized = normalizeEvidenceInventory(generated);

    assert.deepEqual(normalized, {
        schemaVersion: "evidence-inventory/v1",
        kind:          "case_evidence_inventory",
        language:      "es_CL",
        facts:         [fact()],
        exclusions:    [exclusion()],
        generation:    generated.generation,
    });
});

test("normalizeEvidenceInventory keeps existing ids and numbers new items after the highest", () => {
    const edited = inventory({
        facts: [
            fact({ id: "EV3" }),
            fact({ id: "" }),
            fact({ id: "EV3" }),
            fact({ id: "EV7" }),
        ],
        exclusions: [exclusion({ id: "new" }), exclusion({ id: "EX2" })],
    });

    const normalized = normalizeEvidenceInventory(edited);

    assert.deepEqual(normalized.facts.map(item => item.id), ["EV3", "EV8", "EV9", "EV7"]);
    assert.deepEqual(normalized.exclusions.map(item => item.id), ["EX3", "EX2"]);
});

test("normalizeEvidenceInventory recomputes quote checks against the case text", () => {
    const edited = inventory({
        facts: [
            fact({ sourceQuote: "ambos papás trabajan", sourceQuoteFound: false }),
            fact({ id: "EV2", sourceQuote: "una cita inventada", sourceQuoteFound: true }),
            fact({ id: "EV3", sourceQuote: "  ", sourceQuoteFound: true }),
        ],
    });

    const normalized = normalizeEvidenceInventory(edited, {
        caseText: "12   Ellos son una familia esforzada: ambos papás\n13   trabajan para poder salir adelante.",
    });

    assert.deepEqual(
        normalized.facts.map(item => [item.sourceQuote, item.sourceQuoteFound]),
        [["ambos papás trabajan", true], ["una cita inventada", false], [null, false]]
    );
});

test("normalizeEvidenceInventory fills optional fields and falls back to the case language", () => {
    const normalized = normalizeEvidenceInventory({
        facts:      [{ statement: "  Un   hecho  " }],
        exclusions: [{ statement: "Algo que el caso no dice." }],
    }, { language: "en_US" });

    assert.equal(normalized.language, "en_US");
    assert.deepEqual(normalized.facts[0], {
        id:               "EV1",
        group:            "General",
        label:            "Un hecho",
        statement:        "Un hecho",
        sourceQuote:      null,
        sourceQuoteFound: false,
        countingNote:     null,
    });
    assert.deepEqual(normalized.exclusions[0], {
        id:        "EX1",
        label:     "Algo que el caso no dice.",
        statement: "Algo que el caso no dice.",
        reason:    null,
    });
    assert.equal("generation" in normalized, false);
});

test("normalizeEvidenceInventory rejects invalid documents with details", () => {
    const invalidDocuments = [
        [null, "inventory must be an object"],
        [{ facts: "x", exclusions: [] }, "facts must be an array"],
        [inventory({ facts: Array.from({ length: MAX_FACTS + 1 }, () => fact()) }), "facts must have at most 60 items"],
        [
            inventory({ exclusions: Array.from({ length: MAX_EXCLUSIONS + 1 }, () => exclusion()) }),
            "exclusions must have at most 25 items",
        ],
        [inventory({ facts: [fact({ statement: " " })] }), "facts[0].statement is required"],
        [inventory({ facts: [fact({ label: "x".repeat(121) })] }), "facts[0].label must have at most 120 characters"],
        [inventory({ exclusions: [exclusion({ reason: "x".repeat(401) })] }), "exclusions[0].reason must have at most 400 characters"],
    ];

    for (const [document, expectedDetail] of invalidDocuments) {
        assert.throws(
            () => normalizeEvidenceInventory(document),
            error => error instanceof EvidenceInventoryValidationError
                && error.details.includes(expectedDetail),
            expectedDetail
        );
    }
});
