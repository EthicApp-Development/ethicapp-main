const TeacherGroupChatController = function($timeout, $element) {
    const $ctrl = this;

    $ctrl.$onInit = function() {
        $ctrl.draftMessage = "";
        $ctrl.replyToMessageId = null;
        $ctrl.lastMessageSignature = "";
    };

    $ctrl.$onChanges = function(changes) {
        if (changes.messages) {
            $ctrl.updateMessageSignature();
            if ($ctrl.replyToMessageId && !$ctrl.getSelectedReplyMessage()) {
                $ctrl.clearReplyTarget();
            }
            $ctrl.scrollChatToBottom();
        }
    };

    $ctrl.$doCheck = function() {
        const currentSignature = $ctrl.getMessageSignature();
        if (currentSignature !== $ctrl.lastMessageSignature) {
            $ctrl.lastMessageSignature = currentSignature;
            $ctrl.scrollChatToBottom();
        }
    };

    $ctrl.getMessages = function() {
        return Array.isArray($ctrl.messages) ? $ctrl.messages : [];
    };

    $ctrl.getMessageSignature = function() {
        const messages = $ctrl.getMessages();
        const lastMessage = messages[messages.length - 1];
        return `${messages.length}:${lastMessage?.id || ""}`;
    };

    $ctrl.updateMessageSignature = function() {
        $ctrl.lastMessageSignature = $ctrl.getMessageSignature();
    };

    $ctrl.scrollChatToBottom = function() {
        $timeout(() => {
            const chatTranscript = $element[0].querySelector(".teacher-group-chat-transcript");
            if (chatTranscript) {
                chatTranscript.scrollTop = chatTranscript.scrollHeight;
            }
        }, 0);
    };

    $ctrl.getChatAuthorName = function(message) {
        if (typeof $ctrl.resolveAuthorName === "function") {
            return $ctrl.resolveAuthorName({ message });
        }

        return message?.authorName || "";
    };

    $ctrl.isOwnMessage = function(message) {
        if (typeof $ctrl.resolveIsOwnMessage === "function") {
            return $ctrl.resolveIsOwnMessage({ message }) === true;
        }

        return false;
    };

    $ctrl.getChatMessageById = function(messageId) {
        const normalizedMessageId = Number(messageId);
        return $ctrl.getMessages().find((message) =>
            Number(message.id) === normalizedMessageId
        ) || null;
    };

    $ctrl.getSelectedReplyMessage = function() {
        return $ctrl.getChatMessageById($ctrl.replyToMessageId);
    };

    $ctrl.selectReplyTarget = function(message) {
        const normalizedMessageId = Number(message?.id);
        if (!$ctrl.canUseLiveChat || !Number.isInteger(normalizedMessageId)) {
            return;
        }

        $ctrl.replyToMessageId = normalizedMessageId;
    };

    $ctrl.clearReplyTarget = function() {
        $ctrl.replyToMessageId = null;
    };

    $ctrl.getReplyTarget = function(message) {
        return Number.isInteger(message?.parentId)
            ? $ctrl.getChatMessageById(message.parentId)
            : null;
    };

    $ctrl.getMessageDepth = function(message) {
        const visited = new Set();
        let current = message;
        let depth = 0;

        while (Number.isInteger(current?.parentId) && !visited.has(current.parentId)) {
            visited.add(current.parentId);
            const parent = $ctrl.getChatMessageById(current.parentId);
            if (!parent) {
                break;
            }

            depth += 1;
            current = parent;
        }

        return Math.min(depth, 3);
    };

    $ctrl.getReplyIndentStyle = function(message) {
        const depth = $ctrl.getMessageDepth(message);
        const offset = `${depth * 12}px`;

        if ($ctrl.isOwnMessage(message)) {
            return { "margin-right": offset };
        }

        return { "margin-left": offset };
    };

    $ctrl.sendMessage = function() {
        const content = $ctrl.draftMessage.trim();

        if (!content || !$ctrl.canUseLiveChat || $ctrl.chatSending || typeof $ctrl.onSend !== "function") {
            return;
        }

        const parentId = Number.isInteger($ctrl.replyToMessageId)
            ? $ctrl.replyToMessageId
            : null;

        Promise.resolve($ctrl.onSend({ content, parentId }))
            .then(() => {
                $ctrl.draftMessage = "";
                $ctrl.clearReplyTarget();
                $ctrl.scrollChatToBottom();
            })
            .catch(() => {});
    };

    $ctrl.onChatKeyDown = function(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            $ctrl.sendMessage();
        }
    };
};

const teacherGroupChatComponent = {
    bindings: {
        messages: "<",
        chatLoading: "<",
        chatSending: "<",
        chatError: "<",
        canUseLiveChat: "<",
        onSend: "&",
        resolveAuthorName: "&",
        resolveIsOwnMessage: "&",
    },
    controller: ["$timeout", "$element", TeacherGroupChatController],
    templateUrl: "/assets/static/views/teacher/fragments/teacher-group-chat.template.html",
};

export default teacherGroupChatComponent;
