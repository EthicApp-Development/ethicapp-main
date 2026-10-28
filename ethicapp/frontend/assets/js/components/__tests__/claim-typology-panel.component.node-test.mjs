import assert from "node:assert/strict";
import { describe, it } from "node:test";

import claimTypologyPanelComponent from "../claim-typology-panel.component.js";

// The controller is the last entry of the component's annotated array.
const ClaimTypologyPanelController = claimTypologyPanelComponent.controller.at(-1);

const DESIGN = {
    id:        12,
    caseId:    57,
    userOwned: true,
    locked:    false,
    type:      "semantic_differential",
    phases:    [{ questions: [{ q_text: "Should Camila omit the data?" }] }],
};

// The unit the backend selects (#865): the panel never selects or hashes
// questions itself.
const UNIT = Object.freeze({
    id:             "p1-q1",
    phaseNumber:    1,
    questionNumber: 1,
    text:           "Should Camila omit the data?",
    textHash:       "sha256:current",
});

const DOCUMENT = {
    schemaVersion: "claim-typology/v1",
    typologies:    [{
        questionId:       "p1-q1",
        phaseId:          1,
        focalAction:      "Omit the data",
        questionTextHash: "sha256:old",
        types:            [{
            id: "AF1", label: "Omit", description: "...", stance: "in_favor", relatedEvidenceIds: ["EV1"],
        }],
    }],
};

// One answer of DesignAnalysesService.getAnalysis().
function read(analysis, overrides = {}) {
    return {
        analysis,
        units:          [UNIT],
        unitsReason:    null,
        producerUsable: true,
        tutorModes:     { "p1-q1": { mode: "basic", reason: "typology-out-of-date" } },
        ...overrides,
    };
}

function fakeTimeout() {
    const timers = new Set();
    const $timeout = (callback, delay) => {
        const timer = { callback, delay };
        timers.add(timer);
        return timer;
    };
    $timeout.cancel = timer => timers.delete(timer);
    return { $timeout, timers };
}

function createPanel({ design = DESIGN, analyses = [], inventory = null, generate } = {}) {
    const results = [...analyses];
    const calls = { get: [], inventory: [], generate: [], scrolled: 0 };
    const { $timeout, timers } = fakeTimeout();
    const designAnalyses = {
        getAnalysis: async (designId, serviceId) => {
            calls.get.push({ designId, serviceId });
            const next = results.length > 1 ? results.shift() : results[0];
            if (next instanceof Error) {
                throw next;
            }
            return next ?? null;
        },
        generateAnalysis: async (designId, serviceId) => {
            calls.generate.push({ designId, serviceId });
            return generate ?? { outcome: "accepted", analysis: null };
        },
    };
    const caseAnalyses = {
        getAnalysis: async (caseId, serviceId) => {
            calls.inventory.push({ caseId, serviceId });
            if (inventory instanceof Error) {
                throw inventory;
            }
            return inventory;
        },
    };
    const $element = [{ scrollIntoView: () => { calls.scrolled += 1; } }];
    const views = [];
    const vm = new ClaimTypologyPanelController(
        { $applyAsync: () => {} }, $timeout, $element, designAnalyses, caseAnalyses
    );
    vm.design = design;
    vm.onViewChanged = ({ view }) => views.push(view);

    return { vm, calls, timers, views };
}

function quietly(action) {
    const originalError = console.error;
    console.error = () => {};
    return Promise.resolve().then(action).finally(() => { console.error = originalError; });
}

describe("claimTypologyPanel", () => {
    it("renders the backend's units with the typology, the cited evidence and the tutor mode", async () => {
        const { vm, calls, views, timers } = createPanel({
            analyses:  [read({ status: "ready", stale: false, document: DOCUMENT })],
            inventory: { document: { facts: [{ id: "EV1", statement: "Participation fell." }] } },
        });

        await vm.$onInit();

        assert.deepEqual(calls.get, [{ designId: 12, serviceId: "case-analyst-claim-typology" }]);
        assert.deepEqual(calls.inventory, [{ caseId: 57, serviceId: "case-analyst-evidence-inventory" }]);
        assert.equal(vm.isVisible(), true);
        assert.equal(views.length, 1);
        const [question] = views[0].byPhase[1];
        assert.equal(question.text, "Should Camila omit the data?");
        assert.equal(question.outOfDate, true, "the stored hash is not the current text's");
        assert.deepEqual(question.typology.types[0].evidence, [{ id: "EV1", statement: "Participation fell." }]);
        assert.deepEqual(question.tutorMode, {
            enhanced:  false,
            reasonKey: "tutor_mode_reason_typology_out_of_date",
            action:    "generate-typology",
        });
        assert.equal(views[0].caseId, 57);
        assert.equal(views[0].canGenerate, true);
        assert.equal(timers.size, 0, "nothing to poll for a ready analysis");
    });

    it("shows the cited ids alone when the inventory cannot be read", async () => {
        const { vm, views } = createPanel({
            analyses:  [read({ status: "ready", stale: false, document: DOCUMENT })],
            inventory: new Error("forbidden"),
        });

        await vm.$onInit();

        assert.deepEqual(views[0].byPhase[1][0].typology.types[0].evidence, [{ id: "EV1", statement: null }]);
    });

    it("polls while a generation is in flight and stops when it ends", async () => {
        const { vm, calls, timers, views } = createPanel({
            analyses: [
                read({ status: "processing", stale: false, document: null }),
                read({ status: "ready", stale: false, document: DOCUMENT }),
            ],
        });

        await vm.$onInit();
        assert.equal(vm.state(), "pending");
        assert.equal(timers.size, 1);

        const [timer] = timers;
        timers.delete(timer);
        await timer.callback();

        assert.equal(calls.get.length, 2);
        assert.equal(vm.state(), "ready");
        assert.equal(timers.size, 0);
        assert.equal(views.length, 2);
    });

    it("stays hidden for designs of other teachers and reads nothing", async () => {
        const { vm, calls } = createPanel({ design: { ...DESIGN, userOwned: false } });

        await vm.$onInit();

        assert.equal(calls.get.length, 0);
        assert.equal(vm.isVisible(), false);
    });

    it("is shown without an analysis when the backend selects questions for a design with a case", async () => {
        const withQuestions = createPanel({ analyses: [read(null)] });
        await withQuestions.vm.$onInit();
        assert.equal(withQuestions.vm.isVisible(), true);
        assert.equal(withQuestions.vm.state(), "none");
        assert.equal(withQuestions.vm.canGenerate(), true);

        const withoutCase = createPanel({ design: { ...DESIGN, caseId: null }, analyses: [read(null)] });
        await withoutCase.vm.$onInit();
        assert.equal(withoutCase.vm.isVisible(), false);

        const noConsumer = createPanel({
            analyses: [read(null, { units: [], unitsReason: "no-consumer", tutorModes: {} })],
        });
        await noConsumer.vm.$onInit();
        assert.equal(noConsumer.vm.isVisible(), false, "a design whose phases use no consumer");
    });

    it("with the tutor switched off, lists no question and says why", async () => {
        const { vm, views } = createPanel({
            analyses: [read(
                { status: "ready", stale: false, document: DOCUMENT },
                { units: [], unitsReason: "consumers-unusable", tutorModes: {} }
            )],
        });

        await vm.$onInit();

        assert.equal(vm.isVisible(), true);
        assert.deepEqual(views[0].byPhase, {}, "no question is listed as awaiting a typology");
        assert.equal(views[0].outOfDateCount, 0);
        assert.equal(views[0].missingCount, 0);
        assert.equal(vm.unitsReasonKey(), "claim_typology_units_consumers_unusable");
        assert.equal(vm.canGenerate(), false);

        const withoutAnalysis = createPanel({
            analyses: [read(null, { units: [], unitsReason: "consumers-unusable", tutorModes: {} })],
        });
        await withoutAnalysis.vm.$onInit();
        assert.equal(withoutAnalysis.vm.isVisible(), true, "the panel explains it even before a generation");
    });

    it("does not offer a generation while the typology service is switched off", async () => {
        const { vm } = createPanel({ analyses: [read(null, { producerUsable: false })] });

        await vm.$onInit();

        assert.equal(vm.isProducerUnavailable(), true);
        assert.equal(vm.canGenerate(), false);
    });

    it("requests a new generation and explains a refusal", async () => {
        const { vm, calls } = createPanel({
            analyses: [read({ status: "failed", stale: false, document: null, errorCode: "service-failed" })],
            generate: { outcome: "disabled", analysis: null },
        });
        await vm.$onInit();
        assert.equal(vm.canGenerate(), true);

        vm.askToGenerate();
        await vm.confirmGenerate();

        assert.deepEqual(calls.generate, [{ designId: 12, serviceId: "case-analyst-claim-typology" }]);
        assert.equal(vm.notice.key, "claim_typology_generate_disabled");
        assert.equal(calls.get.length, 2, "the analysis is read again");
    });

    it("asks for confirmation when a question's note requests a generation", async () => {
        const { vm, views, calls } = createPanel({ analyses: [read({ status: "ready", stale: false, document: DOCUMENT })] });
        await vm.$onInit();

        views[0].requestGenerate();

        assert.equal(vm.confirmingGenerate, true);
        assert.equal(calls.scrolled, 1, "the panel's confirmation is brought into view");
        assert.deepEqual(calls.generate, [], "nothing is requested before the confirmation");
    });

    it("reports a failed load and offers a retry", async () => {
        const { vm } = createPanel({ analyses: [Object.assign(new Error("boom"), { status: 500 })] });

        await quietly(() => vm.$onInit());

        assert.equal(vm.loadFailed, true);
    });

    it("stops polling when it is destroyed", async () => {
        const { vm, timers } = createPanel({ analyses: [read({ status: "requested", stale: false })] });

        await vm.$onInit();
        assert.equal(timers.size, 1);
        vm.$onDestroy();
        assert.equal(timers.size, 0);
    });
});
