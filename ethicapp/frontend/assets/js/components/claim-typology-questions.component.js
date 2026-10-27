// The claim typology of the tutor questions of one phase (#849), inside the
// phase of the design view: for each question, its focal action and claim
// types (stance, description, example statement and cited evidence), or why
// it has none. Read-only. `questions` and `state` come from the view that
// claim-typology-panel builds (helpers/claim-typology.js).

function ClaimTypologyQuestionsController() {
    const vm = this;

    vm.isPending = function() {
        return vm.state === "pending";
    };
}

export default {
    bindings: {
        questions: "<",
        state:     "<",
    },
    controller:  ClaimTypologyQuestionsController,
    templateUrl: "/assets/static/views/teacher/fragments/claim-typology-questions.template.html",
};
