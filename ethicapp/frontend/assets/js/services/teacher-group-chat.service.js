let TeacherGroupChatService = function($http, TeacherSocketService) {
    const normalizeMessage = function(message) {
        const id = Number(message?.id ?? message?.msgid ?? message?.mid);
        const uid = Number(message?.uid ?? message?.user_id ?? message?.author_id);
        const parentId = Number(message?.parent_id ?? message?.parentId);

        return {
            id: Number.isInteger(id) ? id : Date.now() + Math.random(),
            uid: Number.isInteger(uid) ? uid : null,
            authorRole: message?.author_role || message?.authorRole || null,
            authorName: message?.author_name || message?.authorName || "",
            content: typeof message?.content === "string" ? message.content.trim() : "",
            stime: message?.stime || message?.created_at || message?.createdAt || null,
            parentId: Number.isInteger(parentId) ? parentId : null,
            groupId: Number(message?.groupId ?? message?.group_id ?? message?.tmid) || null,
            phaseId: Number(message?.phaseId ?? message?.phase_id ?? message?.stageid) || null,
            questionId: Number(message?.questionId ?? message?.question_id ?? message?.did) || null,
        };
    };

    const service = {
        normalizeMessage,

        loadMessages: async function(groupId, questionId) {
            const response = await $http.get(`/groups/${groupId}/question/${questionId}/chat_messages`);
            const transcript = Array.isArray(response?.data?.chat_transcript)
                ? response.data.chat_transcript
                : [];

            return transcript
                .map(normalizeMessage)
                .filter((message) => message.content.length > 0);
        },

        sendMessage: async function({ phaseId, questionId, groupId, content, parentId = null }) {
            const response = await $http.post(`/phases/${phaseId}/question/${questionId}/chat_messages`, {
                group_id: groupId,
                content,
                parent_id: parentId,
            });

            return normalizeMessage(response?.data?.chat_message);
        },

        subscribeToGroup: function(groupId, onMessage) {
            TeacherSocketService.emitEvent("joinGroupChat", groupId);
            const subscription = TeacherSocketService.fromEvent("onGroupChatMessage").subscribe({
                next: (message) => {
                    const normalizedMessage = normalizeMessage(message);
                    if (Number(normalizedMessage.groupId) !== Number(groupId)) {
                        return;
                    }

                    onMessage(normalizedMessage);
                },
                error: (error) => {
                    console.error(`Websocket error for teacher group chat ${groupId}:`, error);
                },
            });

            return function unsubscribe() {
                subscription.unsubscribe();
                TeacherSocketService.emitEvent("leaveGroupChat", groupId);
            };
        },
    };

    return service;
};

export { TeacherGroupChatService };
