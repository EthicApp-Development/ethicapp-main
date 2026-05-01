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

        $ctrl.group = data.group;
        $ctrl.phaseData = data.phaseData;
        $ctrl.responses = data.responses || [];
        $ctrl.chatMessages = data.chatMessages || [];
        $ctrl.questions = (data.phaseData?.descriptor?.questions || [])
            .map((question, index) => normalizeQuestion(question, index));

        const participantNames = $ctrl.responses.reduce((acc, response) => {
            if (response.userId && response.userName) {
                acc[response.userId] = response.userName;
            }
            return acc;
        }, {});

        $ctrl.buildScaleOptions = function(question) {
            const range = Number(question?.range) || 0;
            return Array.from({ length: range }, (_, i) => i + 1);
        };

        $ctrl.getGroupFallbackTitle = function() {
            return `Group ${$ctrl.group?.groupNumber || ""}`.trim();
        };

        $ctrl.getQuestionResponses = function(question) {
            const questionId = Number(question?.id);
            const questionNumber = Number(question?.number);

            return $ctrl.responses.filter((response) => {
                const sameQuestionId = questionId && Number(response.questionId) === questionId;
                const sameQuestionOrder = questionNumber && Number(response.questionOrder) === questionNumber;
                return sameQuestionId || sameQuestionOrder;
            });
        };

        $ctrl.getUserName = function(userId) {
            return participantNames[userId] || `User ${userId}`;
        };

        $ctrl.close = function() {
            $uibModalInstance.dismiss("close");
        };
    }];
}

export function openSemanticDifferentialGroupResponseModal($uibModal, group, phaseData, responses, chatMessages) {
    if (!group || !phaseData) {
        return null;
    }

    return $uibModal.open({
        animation: true,
        size: "lg",
        backdrop: "static",
        templateUrl: "/assets/static/views/teacher/fragments/sd-group-response-modal.template.html",
        controllerAs: "$ctrl",
        controller: createModalController(),
        resolve: {
            data: () => ({ group, phaseData, responses, chatMessages }),
        },
    });
}
