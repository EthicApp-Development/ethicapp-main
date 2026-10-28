// The claim typology of the tutor questions of one phase (#849), inside the
// phase of the design view: for each question, its focal action and claim
// types (stance, description, example statement and cited evidence), or why
// it has none, and whether the tutor will evaluate it in the enhanced mode
// (#865). Read-only. `questions`, `state`, `caseId` and `canGenerate` come
// from the view that claim-typology-panel builds (helpers/claim-typology.js);
// `onGenerate` asks the panel to confirm a new generation.

import { TUTOR_MODE_ACTIONS } from "../helpers/tutor-modes.js";

function ClaimTypologyQuestionsController() {
    const vm = this;

    vm.isPending = function() {
        return vm.state === "pending";
    };

    vm.offersCaseLink = function(question) {
        return question?.tutorMode?.action === TUTOR_MODE_ACTIONS.OPEN_CASE && Boolean(vm.caseId);
    };

    vm.offersGenerate = function(question) {
        return question?.tutorMode?.action === TUTOR_MODE_ACTIONS.GENERATE_TYPOLOGY
            && vm.canGenerate === true;
    };
}

export default {
    bindings: {
        questions:   "<",
        state:       "<",
        caseId:      "<",
        canGenerate: "<",
        onGenerate:  "&",
    },
    controller:  ClaimTypologyQuestionsController,
    templateUrl: "/assets/static/views/teacher/fragments/claim-typology-questions.template.html",
};
