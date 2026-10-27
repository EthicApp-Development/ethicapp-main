import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseTopicListingViewComponent from "../case-topic-listing-view.component.js";

const CONTROLLER = caseTopicListingViewComponent.controller.at(-1);

const DOCUMENT = Object.freeze({
    schemaVersion: "topic-listing/v1",
    language:      "en_US",
    topics:        [
        { id: "T1", topic: "Honesty of the record", description: "Whether Camila may sign." },
        { id: "T2", topic: "Hierarchy", description: "How the evaluation weighs." },
    ],
});

function analysisOf(overrides = {}) {
    return {
        serviceId:  "case-analyst-topic-listing",
        status:     "ready",
        stale:      false,
        reviewedAt: null,
        document:   DOCUMENT,
        ...overrides,
    };
}

function makeController({ saveAnalysis } = {}) {
    const focused = [];
    const saved = [];
    const updates = [];
    const $window = { document: { getElementById: id => ({ focus: () => focused.push(id) }) } };
    const $timeout = run => run();
    const $translate = { instant: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key) };
    const CaseAnalysesService = {
        saveAnalysis: saveAnalysis ?? (async (caseId, serviceId, document) => {
            saved.push({ caseId, serviceId, document });
            return analysisOf({ reviewedAt: "2026-10-27T16:00:00Z", document: { ...document, language: "en_US" } });
        }),
    };
    const $scope = { $applyAsync: () => {} };

    const vm = new CONTROLLER($scope, $window, $timeout, $translate, CaseAnalysesService);
    vm.caseItem = { id: 7 };
    vm.analysis = analysisOf();
    vm.onAnalysisUpdated = ({ analysis }) => updates.push(analysis);
    vm.$onChanges({ analysis: { currentValue: vm.analysis } });

    return { vm, focused, saved, updates };
}

describe("case-topic-listing-view", () => {
    it("takes the bindings of an analysis tab component", () => {
        assert.deepEqual(caseTopicListingViewComponent.bindings, {
            analysis:          "<",
            caseItem:          "<",
            onAnalysisUpdated: "&",
        });
    });

    it("reads the topics of each analysis that arrives", () => {
        const { vm } = makeController();

        assert.deepEqual(vm.topics.map(topic => topic.id), ["T1", "T2"]);
        assert.equal(vm.countKey(), "case_topic_listing_count_other");

        vm.analysis = analysisOf({ document: { topics: [DOCUMENT.topics[1]] } });
        vm.$onChanges({ analysis: { currentValue: vm.analysis } });
        assert.deepEqual(vm.topics.map(topic => topic.id), ["T2"]);
        assert.equal(vm.countKey(), "case_topic_listing_count_one");
    });

    it("offers no edit while a generation is in flight", () => {
        const { vm } = makeController();
        assert.equal(vm.canEdit(), true);

        vm.analysis = analysisOf({ status: "processing" });
        assert.equal(vm.canEdit(), false);
        assert.equal(vm.generationRunning(), true);
        assert.equal(vm.canSave(), false);
    });

    it("adds, reorders and removes topics, announcing and keeping the keyboard on them", () => {
        const { vm, focused } = makeController();
        vm.startEditing();
        const [first, second] = vm.draft.topics;
        assert.equal(focused.at(-1), vm.controlId(first, "topic"));

        vm.addTopic();
        const added = vm.draft.topics[2];
        assert.equal(added.id, "");
        assert.equal(focused.at(-1), vm.controlId(added, "topic"));
        assert.match(vm.announcement, /case_topic_listing_added_announcement/);

        vm.moveTopic(2, -1);
        assert.deepEqual(vm.draft.topics.map(topic => topic.key), [first.key, added.key, second.key]);
        // The new topic has no name yet, so it is announced by its position.
        assert.match(vm.announcement, /case_topic_listing_topic_fallback \{"position":2\}$/);
        assert.equal(focused.at(-1), vm.controlId(added, "up"));

        vm.moveTopic(0, 1);
        assert.match(vm.announcement, / Honesty of the record$/);
        assert.equal(focused.at(-1), vm.controlId(first, "down"));

        vm.removeTopic(2);
        assert.deepEqual(vm.draft.topics.map(topic => topic.key), [added.key, first.key]);
        assert.equal(focused.at(-1), vm.controlId(first, "remove"));
        assert.match(vm.announcement, /^case_topic_listing_removed_announcement /);
    });

    it("never removes the last topic nor adds past the limit", () => {
        const { vm } = makeController();
        vm.startEditing();
        vm.removeTopic(0);
        assert.equal(vm.canRemoveTopic(), false);
        vm.removeTopic(0);
        assert.equal(vm.draft.topics.length, 1);

        while (vm.canAddTopic()) {
            vm.addTopic();
        }
        vm.addTopic();
        assert.equal(vm.draft.topics.length, 20);
    });

    it("saves the draft as reviewed and hands the stored analysis to the panel", async () => {
        const { vm, saved, updates } = makeController();
        vm.startEditing();
        vm.moveTopic(1, -1);

        await vm.save({ $invalid: false });

        assert.deepEqual(saved, [{
            caseId:    7,
            serviceId: "case-analyst-topic-listing",
            document:  {
                schemaVersion: "topic-listing/v1",
                language:      "en_US",
                topics:        [DOCUMENT.topics[1], DOCUMENT.topics[0]],
            },
        }]);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].reviewedAt, "2026-10-27T16:00:00Z");
        assert.equal(vm.editing, false);
        assert.equal(vm.alert.messageKey, "case_topic_listing_saved");
    });

    it("does not send an invalid form", async () => {
        const { vm, saved } = makeController();
        vm.startEditing();
        let submitted = false;

        await vm.save({ $invalid: true, $setSubmitted: () => { submitted = true; } });

        assert.equal(submitted, true);
        assert.deepEqual(saved, []);
    });

    it("keeps the draft and lists the server's problems when a save is refused", async () => {
        const { vm, updates } = makeController({
            saveAnalysis: async () => {
                throw { status: 400, data: { details: ["Topic 1: the topic must not be blank."] } };
            },
        });
        vm.startEditing();
        const consoleError = console.error;
        console.error = () => {};
        try {
            await vm.save({ $invalid: false });
        } finally {
            console.error = consoleError;
        }

        assert.equal(vm.editing, true);
        assert.equal(vm.draft.topics.length, 2);
        assert.deepEqual(vm.alert, {
            type:       "danger",
            messageKey: "case_topic_listing_error_invalid",
            details:    ["Topic 1: the topic must not be blank."],
        });
        assert.deepEqual(updates, []);
        assert.equal(vm.saving, false);
    });

    it("cancels without saving and gives the keyboard back to the edit button", () => {
        const { vm, focused, saved } = makeController();
        vm.startEditing();
        vm.cancelEditing();

        assert.equal(vm.editing, false);
        assert.equal(vm.draft, null);
        assert.deepEqual(saved, []);
        assert.equal(focused.at(-1), vm.elementId("edit"));
    });
});
