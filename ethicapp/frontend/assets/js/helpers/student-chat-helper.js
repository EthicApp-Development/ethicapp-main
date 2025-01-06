export const sdAddChatMessage = function(scope, message) {
    try {
        // Find the differential
        const df = scope.dfs.find((e) => e.id === message.did);
        df.c = df.c ? df.c + 1 : 1;

        if (df.id === scope.selectedDF) {
            df.cr = df.c;
        }

        if (message.parent_id) {
            // Assign the parent message
            message.parent = scope.chatMsgs.find((e) => e.id === message.parent_id);
        }

        // Group messages by differential ID
        scope.chatMsgs[message.did] = scope.chatMsgs[message.did] || [];
        scope.chatMsgs[message.did].push(message);

        return true;
    } catch (error) {
        console.error("[sdAddChatMessage] Could not add chat message to the target scope");
        return false;
    }
};
