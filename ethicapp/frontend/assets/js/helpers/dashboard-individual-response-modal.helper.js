function normalizeQuestion(question, index) {
    const ansFormat = question?.ans_format || {};

    const normalizedNumber = Number(
        question?.number
        || question?.order
        || question?.itemNumber
        || index + 1
    );

    return {
        ...question,
        number: normalizedNumber,
        text: question?.text
            || question?.q_text
            || question?.qText
            || question?.question
            || question?.name
            || question?.title
            || question?.label
            || null,
        leftPole: question?.leftPole
            || question?.left_pole
            || question?.l_pole
            || question?.tleft
            || ansFormat?.l_pole
            || null,
        rightPole: question?.rightPole
            || question?.right_pole
            || question?.r_pole
            || question?.tright
            || ansFormat?.r_pole
            || null,
        range: Number(
            question?.range
            || question?.num
            || question?.values
            || ansFormat?.values
            || 0
        ),
        justify: typeof question?.justify === "boolean"
            ? question.justify
            : (typeof question?.justificationRequired === "boolean"
                ? question.justificationRequired
                : Boolean(ansFormat?.just_required)),
    };
}

function createModalController() {
    return ["$uibModalInstance", "data", function($uibModalInstance, data) {
        const $ctrl = this;

        $ctrl.response = data.response;
        $ctrl.phaseData = data.phaseData;
        $ctrl.questions = (data.phaseData?.descriptor?.questions || [])
            .map((question, index) => normalizeQuestion(question, index));

        $ctrl.buildScaleOptions = function(question) {
            const range = Number(question?.range) || 0;
            return Array.from({ length: range }, (_, i) => i + 1);
        };

        $ctrl.getResponseValue = function(question) {
            return $ctrl.response?.[`r${question.number}`] || null;
        };

        $ctrl.getResponseComment = function(question) {
            return $ctrl.response?.[`commentR${question.number}`] || "";
        };

        $ctrl.close = function() {
            $uibModalInstance.dismiss("close");
        };
    }];
}

export function openSemanticDifferentialIndividualResponseModal($uibModal, response, phaseData) {
    if (!response || !phaseData) {
        return null;
    }

    return $uibModal.open({
        animation: true,
        size: "lg",
        backdrop: "static",
        templateUrl: "/assets/static/views/teacher/fragments/sd-individual-response-modal.template.html",
        controllerAs: "$ctrl",
        controller: createModalController(),
        resolve: {
            data: () => ({ response, phaseData }),
        },
    });
}
