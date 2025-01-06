export const sdAddChatMessage = function(scope, message) {
    try {
        // Find the differential
        const df = scope.dfs.find((e) => e.id === message.questionId);
        df.c = df.c ? df.c + 1 : 1;

        if (df.id === scope.selectedDF) {
            df.cr = df.c;
        }

        if (message.parentId) {
            // Assign the parent message
            message.parent = scope.chatMsgs.find((e) => e.id === message.parentId);
        }

        // Group messages by differential ID
        scope.chatMsgs[message.questionId] = scope.chatMsgs[message.questionId] || [];
        scope.chatMsgs[message.questionId].push(message);

        return true;
    } catch (error) {
        console.error("[sdAddChatMessage] Could not add chat message to the target scope");
        return false;
    }
};
