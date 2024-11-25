let ActivityStateService = ($http, SocketService) => {
    const service = {
        subscriptionsMap: {}, // Subscription to socket events
        activityStates: {}, // Activity states
        listeners: {}, // Subscribed listeners

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

        subscribeToActivityEvents: (sessionId) => {
            // Check if there are already subscriptions for this sessionId
            if (service.subscriptionsMap.has(sessionId)) {
                console.warn(`Subscriptions for session ${sessionId} already exist.`);
                return service.subscriptionsMap.get(sessionId).unsubscribeAll; // Return the existing unsubscribe function
            }
        
            // Join the room for the given sessionId
            SocketService.joinRoom(sessionId);
        
            const subscriptions = [];
        
            // Subscribe to `onResponseSubmitted`
            subscriptions.push(
                SocketService.fromEvent('onResponseSubmitted').subscribe({
                    next: async (data) => {
                        console.debug(`Response submitted for session ${sessionId}:`, 
                            JSON.stringify(data));
                        
                        const handler = responseMergeHandlers[data.type];
                        
                        if (!handler) {
                            const msg = "No handler available for the incoming response data";
                            console.error(msg);
                            throw new Error(msg);                           
                        }

                        handler(data, service.activityStates[sessionId].responses);

                        // Get updated stats for the phase
                        const stats = await service.getPhaseStats(data.phaseId);

                        // Notify listeners
                        service.notifyListeners("onResponseSubmitted", { 
                            response: data, stats: stats });
                    },
                    error: (err) => console.error(`Websocket error for responseSubmitted in session ${sessionId}:`, err),
                })
            );
        
            // Subscribe to `onChatMessage`
            subscriptions.push(
                SocketService.fromEvent('onChatMessage').subscribe({
                    next: (data) => {
                        console.debug(`New chat message ${sessionId}:`, data);
                        // Update the phase in activityStates
                        service.activityStates[sessionId].currentPhase = data.phaseId;
                    },
                    error: (err) => console.error(`Websocket error for phaseChanged in session ${sessionId}:`, err),
                })
            );
        
            // Function to unsubscribe all subscriptions
            const unsubscribeAll = () => {
                subscriptions.forEach((subscription) => subscription.unsubscribe());
                SocketService.leaveRoom(sessionId);
                service.subscriptionsMap.delete(sessionId); // Remove from the map
            };
        
            // Store the subscriptions in the map
            service.subscriptionsMap.set(sessionId, { subscriptions, unsubscribeAll });
        
            return unsubscribeAll; // Return the unsubscribe function
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

        registerListener: (eventName, callback) => {
            if (!listeners[eventName]) {
                listeners[eventName] = [];
            }
            listeners[eventName].push(callback);
        },

        notifyListeners: (eventName, data) => {
            if (listeners[eventName]) {
                listeners[eventName].forEach((callback) => callback(data));
            }
        },

        getChatMessageCount: async function(phaseId) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/phases/${phaseId}/message_count`);
                
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

        getPhaseStats: async function(phaseId) {
            // Fetch statistics for the requested phase
            const response = await $http.get(`/phases/${phaseId}/stats`);
            return response;
        },

        getChatMessages: async function(groupId, questionId) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/groups/${groupId}/question/${questionId}/chat`);
                
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

const responseMergeHandlers = {
    ranking: rankingResponseMerger,
    "semantic-differential" : semanticDifferentialResponseMerger
};

let rankingResponseMerger = (response, responses) => {
    const existingResponse = responses.find(
        (resp) => resp.phaseId === response.phaseId && resp.uid === response.uid
    );

    if (existingResponse) {
        existingResponse.items = response.items;
    } else {
        const { type, ...responseWithoutType } = response;
        responses.push(responseWithoutType);
    }
};

let semanticDifferentialResponseMerger = (response, responses) => {
    const existingResponse = responses.find(
        (resp) => resp.phaseId === response.phaseId &&  resp.did == response.did && 
            resp.uid === response.uid
    );

    if (existingResponse) {
        existingResponse.comment = response.comment;
        existingResponse.sel = response.sel;
    } else {
        const { type, ...responseWithoutType } = response;
        responses.push(responseWithoutType);
    }
};

export { ActivityStateService };
