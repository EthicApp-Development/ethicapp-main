let ActivityStateService = ($http) => {
    const service = {
        activityStates: {},

        loadActivityState: async function(sessionId) {
            try {
                // list of connected users
                const users = await $http.get('/sessions/' + sessionId + '/users');

                // get the activity descriptor (description, designId, status, phases{number,id},
                // and currentPhase)
                const descriptor = await $http.get('/activities/' + sessionId + '/descriptor');

                // list of activity phases that have been run so far
                const phaseInstances = await $http.get('/activities/' + sessionId + '/phases');

                // load activity responses
                const responses = await $http.get('/activities/' + sessionId + '/responses');
                
                service.activityStates[sessionId] = { 
                    users: users, 
                    descriptor: descriptor,
                    phases: phaseInstances,
                    responses: responses
                };

                return service.activityStates[sessionId];
            }
            catch (error) {
                console.error(`Failed to load state for session with id ${sessionId}`);
                return null;
            }
        },

        getSessionUsers: async function(sessionId, refresh = false) {
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Activity state not found for session with id '${sessionId}'`);
            }

            if (refresh) {
                try {
                    const users = await $http.get('/sessions/' + sessionId + '/users');
                    service.activityStates[sessionId].users = users;
                }
                catch (error) {
                    console.error(`Failed to get users in session ${sessionId}.`);
                    throw new Error(error);
                }
            }

            return service.activityStates[sessionId].users;
        },

        getChatMessageCount: async function(phase_id) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/phases/${phase_id}/message_count`);
                
                // Check if the response data is valid and contains the expected "messages" field
                if (response && response.data && Array.isArray(response.data.messages)) {
                    return response.data.messages; // Return the list of message counts
                } else {
                    console.warn("Unexpected response format:", response);
                    return []; // Return an empty array if the format is not as expected
                }
            } catch (error) {
                // Log the error for debugging purposes
                console.error("Error fetching chat message count:", error);
                return []; // Return an empty array in case of an error
            }
        },

        getChatMessages: async function(group_id, question_id) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/groups/${group_id}/question/${question_id}/chat`);
                
                // Check if the response data is valid and contains the expected "chat_transcript" field
                if (response && response.data && Array.isArray(response.data.chat_transcript)) {
                    return response.data.chat_transcript; // Return the list of chat messages
                } else {
                    console.warn("Unexpected response format:", response);
                    return []; // Return an empty array if the format is not as expected
                }
            } catch (error) {
                // Log the error for debugging purposes
                console.error("Error fetching chat messages:", error);
                return []; // Return an empty array in case of an error
            }
        },

        getActivityState: async function(sessionId, refresh = false) {
            if (refresh) {
                await service.loadActivityState(sessionId);
            }
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Activity state not found for session with id '${sessionId}'`);
            }
            return service.activityStates[sessionId];
        },
    };

    return service; 
};

export { ActivityStateService };
