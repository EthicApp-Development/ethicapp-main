// The topic listing tab of the case view (#845): the review panel of the
// `case-analyst-topic-listing` analysis (document topic-listing/v1). The
// teacher reads the topics participants must address, edits, adds, removes
// and reorders them, and saves the listing as reviewed through
// PUT /cases/:id/analyses/:serviceId. "Generate again" and the generation
// status belong to the surrounding case analysis panel (#651).

import {
    canAddTopic,
    canEditTopicListing,
    canRemoveTopic,
    createEmptyTopic,
    createTopicKeys,
    createTopicListingDraft,
    isTopicListingReviewed,
    moveDraftTopic,
    removeDraftTopic,
    TOPIC_LISTING_LIMITS,
    topicCountKey,
    topicListingDraftDocument,
    topicListingSaveError,
    topicListingTopics,
} from "../helpers/topic-listing.js";
import { moveFocusDirection } from "../helpers/ordered-list.js";

// Element ids must be unique on the page, so each instance has its own prefix.
let instances = 0;

function CaseTopicListingViewController(
    $scope, $window, $timeout, $translate, CaseAnalysesService
) {
    const vm = this;
    let destroyed = false;

    instances += 1;
    const idPrefix = `topicListing${instances}`;
    const nextKey = createTopicKeys(idPrefix);

    vm.limits = TOPIC_LISTING_LIMITS;
    vm.topics = [];
    vm.editing = false;
    vm.draft = null;
    vm.saving = false;
    vm.alert = null;
    vm.announcement = "";

    // A reloaded analysis (for example after a new generation) replaces what
    // is read; a draft being edited is kept until it is saved or cancelled.
    vm.$onChanges = function(changes) {
        if (changes.analysis) {
            vm.topics = topicListingTopics(vm.analysis?.document);
        }
    };

    vm.$onDestroy = function() {
        destroyed = true;
    };

    vm.isReviewed = function() {
        return isTopicListingReviewed(vm.analysis);
    };

    vm.countKey = function() {
        return topicCountKey(vm.topics.length);
    };

    vm.generationRunning = function() {
        return !canEditTopicListing(vm.analysis) && Boolean(vm.analysis?.document);
    };

    vm.canEdit = function() {
        return !vm.editing && !vm.saving && canEditTopicListing(vm.analysis);
    };

    vm.canSave = function() {
        return !vm.saving && canEditTopicListing(vm.analysis);
    };

    vm.canAddTopic = function() {
        return canAddTopic(vm.draft);
    };

    vm.canRemoveTopic = function() {
        return canRemoveTopic(vm.draft);
    };

    vm.startEditing = function() {
        vm.draft = createTopicListingDraft(vm.analysis?.document, nextKey);
        vm.editing = true;
        vm.alert = null;
        vm.announcement = "";
        vm.focusElement(vm.draft.topics[0] ? vm.controlId(vm.draft.topics[0], "topic") : null);
    };

    vm.cancelEditing = function() {
        vm.editing = false;
        vm.draft = null;
        vm.alert = null;
        vm.announcement = "";
        vm.focusElement(vm.elementId("edit"));
    };

    vm.addTopic = function() {
        if (!vm.canAddTopic()) {
            return;
        }
        const topic = createEmptyTopic(nextKey);
        vm.draft = { ...vm.draft, topics: [...vm.draft.topics, topic] };
        vm.announcement = $translate.instant("case_topic_listing_added_announcement", {
            position: vm.draft.topics.length,
        });
        vm.focusElement(vm.controlId(topic, "topic"));
    };

    vm.moveTopic = function(index, offset) {
        const moved = moveDraftTopic(vm.draft, index, offset);
        if (moved === vm.draft) {
            return;
        }

        const topic = vm.draft.topics[index];
        const position = index + offset;
        vm.draft = moved;
        // Names are appended, not passed as translation parameters, which the
        // app sanitizes as HTML.
        vm.announcement = `${$translate.instant("case_topic_listing_moved_announcement", {
            position: position + 1,
            count:    moved.topics.length,
        })} ${vm.topicName(topic, position)}`;
        // Keeps the keyboard on the moved topic.
        const direction = moveFocusDirection(offset, position, moved.topics.length);
        vm.focusElement(vm.controlId(topic, direction));
    };

    vm.removeTopic = function(index) {
        const removed = removeDraftTopic(vm.draft, index);
        if (removed === vm.draft) {
            return;
        }

        const topic = vm.draft.topics[index];
        vm.draft = removed;
        const removedText = $translate.instant("case_topic_listing_removed_announcement");
        vm.announcement = `${removedText} ${vm.topicName(topic, index)}`;
        const next = removed.topics[Math.min(index, removed.topics.length - 1)];
        vm.focusElement(vm.controlId(next, "remove"));
    };

    // The name screen readers hear for a topic: its text, or its position.
    vm.topicName = function(topic, index) {
        const name = typeof topic?.topic === "string" ? topic.topic.trim() : "";
        return name
            || $translate.instant("case_topic_listing_topic_fallback", { position: index + 1 });
    };

    vm.controlId = function(topic, control) {
        return `${topic.key}-${control}`;
    };

    // Ids of the panel's own elements: "edit" (the edit button), "limits".
    vm.elementId = function(name) {
        return `${idPrefix}-${name}`;
    };

    vm.focusElement = function(elementId) {
        if (!elementId) {
            return;
        }
        $timeout(() => {
            $window.document.getElementById(elementId)?.focus();
        });
    };

    vm.save = async function(form) {
        if (form?.$invalid) {
            form.$setSubmitted();
            return;
        }
        if (!vm.canSave()) {
            return;
        }

        vm.saving = true;
        vm.alert = null;

        try {
            const saved = await CaseAnalysesService.saveAnalysis(
                vm.caseItem?.id,
                vm.analysis?.serviceId,
                topicListingDraftDocument(vm.draft)
            );
            if (destroyed) {
                return;
            }
            vm.editing = false;
            vm.draft = null;
            vm.alert = { type: "success", messageKey: "case_topic_listing_saved", details: [] };
            vm.onAnalysisUpdated({ analysis: saved });
            vm.focusElement(vm.elementId("edit"));
        } catch (error) {
            console.error("[caseTopicListingView] Could not save the topic listing.", error);
            if (!destroyed) {
                vm.alert = { type: "danger", ...topicListingSaveError(error) };
            }
        } finally {
            if (!destroyed) {
                vm.saving = false;
                $scope.$applyAsync();
            }
        }
    };
}

export default {
    bindings: {
        analysis:          "<",
        caseItem:          "<",
        onAnalysisUpdated: "&",
    },
    controller: [
        "$scope", "$window", "$timeout", "$translate", "CaseAnalysesService",
        CaseTopicListingViewController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-topic-listing-view.template.html",
};
