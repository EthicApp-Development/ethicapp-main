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
    return ["$scope", "$translate", "$uibModalInstance", "data",
        function($scope, $translate, $uibModalInstance, data) {
        const $ctrl = this;

        $ctrl.group = data.group;
        $ctrl.phaseData = data.phaseData;
        $ctrl.groupChatService = data.groupChatService;
        $ctrl.canUseLiveChat = data.canUseLiveChat === true;
        $ctrl.responses = data.responses || [];
        $ctrl.chatMessages = (data.chatMessages || [])
            .map((message) => $ctrl.groupChatService.normalizeMessage(message))
            .filter((message) => message.content.length > 0);
        $ctrl.chatLoading = false;
        $ctrl.chatSending = false;
        $ctrl.chatError = "";
        $ctrl.unsubscribeFromGroupChat = null;
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

        $ctrl.getChatAuthorName = function(message) {
            if (message?.authorRole === "P") {
                const translatedLabel = $translate.instant("teacher_chat_author_label");
                return translatedLabel && translatedLabel !== "teacher_chat_author_label"
                    ? translatedLabel
                    : "Teacher";
            }

            return participantNames[message.uid] || message.authorName || $ctrl.getUserName(message.uid);
        };

        $ctrl.isTeacherMessage = function(message) {
            return message?.authorRole === "P";
        };

        $ctrl.getFirstQuestionId = function() {
            return Number($ctrl.questions?.[0]?.id);
        };

        $ctrl.reloadChatMessages = async function() {
            const questionId = $ctrl.getFirstQuestionId();
            if (!questionId || !$ctrl.group?.groupId) {
                return;
            }

            $ctrl.chatLoading = true;
            $ctrl.chatError = "";
            try {
                const messages = await $ctrl.groupChatService.loadMessages($ctrl.group.groupId, questionId);
                $scope.$applyAsync(() => {
                    $ctrl.chatMessages = messages;
                    $ctrl.chatLoading = false;
                });
            } catch (error) {
                console.error("Error loading group chat messages:", error);
                $scope.$applyAsync(() => {
                    $ctrl.chatLoading = false;
                    $ctrl.chatError = "Unable to load chat messages.";
                });
            }
        };

        $ctrl.sendChatMessage = async function(content, parentId = null) {
            const questionId = $ctrl.getFirstQuestionId();

            if (!content || !$ctrl.canUseLiveChat || $ctrl.chatSending || !questionId || !$ctrl.group?.groupId) {
                return;
            }

            $ctrl.chatSending = true;
            $ctrl.chatError = "";
            try {
                const sentMessage = await $ctrl.groupChatService.sendMessage({
                    phaseId: $ctrl.phaseData.descriptor.id,
                    questionId,
                    groupId: $ctrl.group.groupId,
                    content,
                    parentId,
                });

                $scope.$applyAsync(() => {
                    if (sentMessage?.content) {
                        const existingMessage = $ctrl.chatMessages.find((chatMessage) =>
                            Number(chatMessage.id) === Number(sentMessage.id)
                        );
                        if (!existingMessage) {
                            $ctrl.chatMessages.push(sentMessage);
                        }
                    }
                    $ctrl.chatSending = false;
                });
            } catch (error) {
                console.error("Error sending teacher group chat message:", error);
                $scope.$applyAsync(() => {
                    $ctrl.chatSending = false;
                    $ctrl.chatError = "Unable to send chat message.";
                });
                throw error;
            }
        };

        $ctrl.$onInit = function() {
            if ($ctrl.canUseLiveChat && $ctrl.group?.groupId) {
                $ctrl.unsubscribeFromGroupChat = $ctrl.groupChatService.subscribeToGroup(
                    $ctrl.group.groupId,
                    (message) => {
                        $scope.$applyAsync(() => {
                            const existingMessage = $ctrl.chatMessages.find((chatMessage) =>
                                Number(chatMessage.id) === Number(message.id)
                            );
                            if (!existingMessage) {
                                $ctrl.chatMessages.push(message);
                            }
                        });
                    }
                );
            }
        };

        $ctrl.$onDestroy = function() {
            if (typeof $ctrl.unsubscribeFromGroupChat === "function") {
                $ctrl.unsubscribeFromGroupChat();
            }
        };

        $ctrl.close = function() {
            $uibModalInstance.dismiss("close");
        };
    }];
}

export function openSemanticDifferentialGroupResponseModal(
    $uibModal,
    groupChatService,
    group,
    phaseData,
    responses,
    chatMessages,
    canUseLiveChat = false
) {
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
            data: () => ({ groupChatService, group, phaseData, responses, chatMessages, canUseLiveChat }),
        },
    });
}
