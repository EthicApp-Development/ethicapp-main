// mediation-decision/v1 records (#1222): validation against EthicApp's copy
// of the schema and the integrity rules of ethicapp_ai_capabilities.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
    createMediationDecisionValidator,
    loggableDecisionId,
    MEDIATION_DECISION_PROBLEM_CODES,
    mediationDecisionIntegrityProblems,
    validateMediationDecision,
} from "../mediation-decision-records.js";

const EXAMPLES_URL = new URL(
    "../../../../canonical-schemas/ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);

function example(name) {
    return JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
}

function codes(result) {
    return result.problems.map(({ code, path }) => `${code} ${path}`);
}

test("every example of the copy is valid", () => {
    const names = readdirSync(EXAMPLES_URL).filter(name => name.endsWith(".json"));
    assert.equal(names.length, 4);
    for (const name of names) {
        assert.deepEqual(validateMediationDecision(example(name)), { valid: true, problems: [] }, name);
    }
});

test("a schema violation names its path and keyword, never a value", () => {
    const record = example("constructive.es_CL.json");
    record.window.messages[0].text = "Ana: firmar está mal";
    record.decidedAt = "yesterday";

    const result = validateMediationDecision(record);

    assert.equal(result.valid, false);
    assert.ok(result.problems.every(problem => problem.code === MEDIATION_DECISION_PROBLEM_CODES.SCHEMA_VIOLATION));
    const paths = result.problems.map(problem => problem.path);
    assert.ok(paths.includes("window.messages[0].text"), paths.join());
    assert.ok(paths.includes("decidedAt"), paths.join());
    assert.equal(JSON.stringify(result).includes("Ana"), false);
    assert.equal(JSON.stringify(result).includes("yesterday"), false);
});

test("only an intervention has a category, a topic and an asked agent", () => {
    const noIntervention = example("no-intervention.es_CL.json");
    noIntervention.category = "STUCK";
    noIntervention.topic = { id: "T1", name: "Lealtad" };
    noIntervention.intervention = {
        status: "suppressed", agent: "ConversationGuide", messageId: null, suppressedBy: "cooldown",
    };
    assert.deepEqual(codes(validateMediationDecision(noIntervention)), [
        "decision_mismatch category",
        "decision_mismatch topic",
        "decision_mismatch intervention.status",
    ]);

    const intervene = example("constructive.es_CL.json");
    intervene.intervention = { status: "not_requested", agent: null, messageId: null, suppressedBy: null };
    assert.deepEqual(codes(validateMediationDecision(intervene)), [
        "decision_mismatch intervention.status",
    ]);
});

test("each intervention status carries exactly its own details", () => {
    const record = example("stuck-suppressed.es_CL.json");
    record.intervention.messageId = 120;
    record.intervention.suppressedBy = null;
    assert.deepEqual(codes(validateMediationDecision(record)), [
        "intervention_mismatch intervention.messageId",
        "intervention_mismatch intervention.suppressedBy",
    ]);

    const failed = example("constructive.es_CL.json");
    failed.intervention = { status: "failed", agent: null, messageId: null, suppressedBy: null };
    assert.deepEqual(codes(validateMediationDecision(failed)), [
        "intervention_mismatch intervention.agent",
    ]);
});

test("a message evaluated twice in one window is refused", () => {
    const record = example("constructive.es_CL.json");
    record.window.messages.push({ ...record.window.messages[0] });
    assert.deepEqual(codes(validateMediationDecision(record)), [
        "duplicate_message_ref window.messages[4].messageId",
    ]);
});

test("integrity rules ignore values the schema already refuses", () => {
    assert.deepEqual(mediationDecisionIntegrityProblems(null), []);
    assert.deepEqual(mediationDecisionIntegrityProblems({ decision: "maybe", intervention: {} }), []);
    assert.deepEqual(mediationDecisionIntegrityProblems({ window: { messages: [{ messageId: "1" }, { messageId: "1" }] } }), []);
});

test("a value with no JSON form, and an unreadable copy, are refused", () => {
    const cyclic = example("no-intervention.es_CL.json");
    cyclic.self = cyclic;
    assert.deepEqual(validateMediationDecision(cyclic).problems, [
        { code: "schema_violation", keyword: "not_json", path: "<root>" },
    ]);

    const errors = [];
    const validate = createMediationDecisionValidator({
        readSchema: () => {
            throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
        },
        logger: { error: (...args) => errors.push(args) },
    });
    assert.deepEqual(validate(example("no-intervention.es_CL.json")), {
        valid:    false,
        problems: [{ code: "schema_unavailable", path: "<root>" }],
    });
    validate(example("no-intervention.es_CL.json"));
    assert.equal(errors.length, 1, "logged once");
});

test("loggableDecisionId gives the UUID only", () => {
    assert.equal(loggableDecisionId(example("unparsed.en_US.json")), "0b9e8a52-7a1f-4f7e-9d43-5c1e2f3a4b04");
    assert.equal(loggableDecisionId({ decisionId: "Ana wrote this" }), null);
    assert.equal(loggableDecisionId({ decisionId: 12 }), null);
    assert.equal(loggableDecisionId(null), null);
});
