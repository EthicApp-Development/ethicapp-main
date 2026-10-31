// One student's answers to a semantic-differential phase, in the response
// detail panel of the teacher's activity dashboard (#896, epic #892): each
// question with its scale, its poles and the justification. It replaces the
// individual response modal and keeps its template. `response` is the
// student's live table row, so new answers show as they arrive.

import { detailQuestions, scaleOptions } from "../helpers/response-detail.js";

function SdStudentResponseDetailController() {
    const $ctrl = this;

    $ctrl.questions = [];

    $ctrl.$onChanges = function(changes) {
        if (changes.phaseData) {
            $ctrl.questions = detailQuestions($ctrl.phaseData);
        }
    };

    $ctrl.buildScaleOptions = function(question) {
        return scaleOptions(question);
    };

    $ctrl.getResponseValue = function(question) {
        return $ctrl.response?.[`r${question.number}`] || null;
    };

    $ctrl.getResponseComment = function(question) {
        return $ctrl.response?.[`commentR${question.number}`] || "";
    };
}

export default {
    bindings: {
        response:   "<",
        phaseData:  "<",
        // The activity case's videos (#785), for the videos in questions.
        caseVideos: "<",
    },
    controller:  [SdStudentResponseDetailController],
    templateUrl: "/assets/static/views/teacher/fragments/sd-student-response-detail.template.html",
};
