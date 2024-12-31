let ActivityStateService = ($http, TeacherSocketService) => {
    const service = {
        subscriptionsMap: new Map(), // Subscription to socket events
        activityStates: {}, // Activity states
        listeners: {}, // Subscribed listeners

        loadActivityState: async function(sessionId) {
            try {
                service.activityStates[sessionId] = { };

                // list of connected users
                await service.getSessionUsers(sessionId, true);

                // get the activity descriptor (description, designId, status, phases{number,id},
                // and currentPhase)
                await service.getActivityDescriptor(sessionId, true);

                // list of activity phases that have been run so far
                await service.getInstancedPhases(sessionId, true);

                // load activity responses
                await service.getResponses(sessionId, true);
        
                return service.activityStates[sessionId];
            }
            catch (error) {
                console.error(`Failed to load state for session with id ${sessionId}`);
                return null;
            }
        },

        subscribeToActivityEvents: (sessionId) => {
            // Load the activity state if not loaded yet
            if (!(sessionId in service.activityStates)) {
                service.loadActivityState(sessionId);
            }

            // Check if there are already subscriptions for this sessionId
            if (service.subscriptionsMap.has(sessionId)) {
                console.warn(`Subscriptions for session ${sessionId} already exist.`);
                return service.subscriptionsMap.get(sessionId).unsubscribeAll; // Return the existing unsubscribe function
            }
        
            // Join the session for the given sessionId
            TeacherSocketService.joinSession(sessionId);
        
            const subscriptions = [];
            
            // Subscribe to `onStudentJoined`
            subscriptions.push(
                TeacherSocketService.fromEvent('onStudentJoined').subscribe({
                    next: async (data) => {
                        console.debug(`Peer joined session ${sessionId}:`, 
                            JSON.stringify(data));
                            
                        const userList = service.activityStates[sessionId].users;
                        const existingUser = userList.find(user => user.id === data.id);

                        if (!existingUser) {
                            userList.push({
                                id: data.id,
                                name: data.name,
                                device: data.device,
                            });
                        }

                        // Notify listeners
                        service.notifyListeners("onStudentJoined", { 
                            response: data });                            
                    },
                    error: (err) => {
                        console.error(`Websocket error for onStudentJoined event in session ${sessionId}:`, err)
                    }
                })
            );

            // Subscribe to `onResponseSubmitted`
            subscriptions.push(
                TeacherSocketService.fromEvent('onResponseSubmitted').subscribe({
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
                
                        service.notifyListeners("onResponseSubmitted", { 
                            response: data
                        });
                    },
                    error: (err) => console.error(`Websocket error for responseSubmitted in session ${sessionId}:`, err),
                })                
            );
        
            // Subscribe to `onChatMessage`
            subscriptions.push(
                TeacherSocketService.fromEvent('onChatMessage').subscribe({
                    next: (data) => {
                        console.debug(`New chat message ${sessionId}:`, data);

                        // Notify listeners
                        service.notifyListeners("onChatMessage", { 
                            messages: data.messages });                        
                    },
                    error: (err) => console.error(`Websocket error for phaseChanged in session ${sessionId}:`, err),
                })
            );
        
            // Function to unsubscribe all subscriptions
            const unsubscribeAll = () => {
                subscriptions.forEach((subscription) => subscription.unsubscribe());
                TeacherSocketService.leaveSession(sessionId);
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
                    const response = await $http.get(`/sessions/${sessionId}/users`);
                    
                    if (response?.data?.users && Array.isArray(response.data.users)) {
                        service.activityStates[sessionId].users = response.data.users;
                    } else {
                        console.warn("Unexpected response format:", response);
                        throw new Error("Invalid response format received from server.");
                    }
                } catch (error) {
                    console.error(`Failed to refresh users in session ${sessionId}:`, error);
                    throw new Error(`Error fetching users for session ${sessionId}: ${error.message}`);
                }
            }
        
            return service.activityStates[sessionId].users;
        },

        getActivityDescriptor: async function(sessionId, refresh = false) {
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Activity descriptor not found for session with id '${sessionId}'`);
            }
        
            if (refresh) {
                try {
                    const response = await $http.get(`/activities/${sessionId}/descriptor`);
                    
                    // Validar el formato de la respuesta
                    if (response?.data?.descriptor) {
                        console.log("[getActivityDescriptor] Activity descriptor:", 
                            JSON.stringify(response.data.descriptor));
                        service.activityStates[sessionId].descriptor = response.data.descriptor;
                    } else {
                        console.warn("Unexpected response format:", response);
                        throw new Error("Invalid response format received from server.");
                    }
                } catch (error) {
                    console.error(`Failed to refresh the activity descriptor for session ${sessionId}:`, error);
                    throw new Error(`Error fetching activity descriptor for session ${sessionId}: ${error.message}`);
                }
            }
        
            return service.activityStates[sessionId].descriptor;
        },

        getResponses: async function(sessionId, refresh = false) {
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Responses not found for activity in session with id '${sessionId}'`);
            }
        
            if (refresh) {
                try {
                    const response = await $http.get(`/activities/${sessionId}/responses`);
                    
                    if (response?.data?.phases && Array.isArray(response.data.phases)) {
                        service.activityStates[sessionId].responses = response.data.phases;
                    } else {
                        console.warn("Unexpected response format:", response);
                        service.activityStates[sessionId].responses = []; // Set to an empty array if no responses are found
                    }
                } catch (error) {
                    if (error.status === 404) {
                        console.warn(`No responses found for session ${sessionId}:`, error);
                        service.activityStates[sessionId].responses = []; // Return an empty array if 404 error
                    } else {
                        console.error(`Failed to refresh responses for session ${sessionId}:`, error);
                        throw new Error(`Error fetching responses for session ${sessionId}: ${error.message}`);
                    }
                }
            }
        
            return service.activityStates[sessionId].responses;
        },

        getInstancedPhases: async function (sessionId, refresh = false) {
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Phase instances not found for activity in session with id '${sessionId}'`);
            }
        
            if (refresh) {
                try {
                    const response = await $http.get(`/activities/${sessionId}/phases`);
                    
                    // Validate response format
                    if (response?.data?.phases && Array.isArray(response.data.phases)) {
                        service.activityStates[sessionId].phases = response.data.phases;
                    } else {
                        console.warn("This activity has no phases yet:", response);
                        service.activityStates[sessionId].phases = []; // Set to an empty array if no phases are found
                    }
                } catch (error) {
                    if (error.status === 404) {
                        console.warn(`No phases found for session ${sessionId}:`, error);
                        service.activityStates[sessionId].phases = []; // Return an empty array if 404 error
                    } else {
                        console.error(`Failed to refresh phase instances for session ${sessionId}:`, error);
                        throw new Error(`Error fetching phases for session ${sessionId}: ${error.message}`);
                    }
                }
            }
        
            return service.activityStates[sessionId].phases;
        },

        registerListener: (eventName, callback) => {
            if (!service.listeners[eventName]) {
                service.listeners[eventName] = [];
            }
            service.listeners[eventName].push(callback);
        },

        unregisterListener: function (eventName, callback) {
            if (service.listeners[eventName]) {
                service.listeners[eventName] = service.listeners[eventName].filter(
                    (listener) => listener !== callback
                );
            }
        },

        notifyListeners: (eventName, data) => {
            if (service.listeners[eventName]) {
                service.listeners[eventName].forEach((callback) => callback(data));
            }
        },

        getGroups: async function(phaseId) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/phases/${phaseId}/groups`);
        
                // Validate the response format
                if (response?.data?.groups && Array.isArray(response.data.groups)) {
                    return response.data.groups; // Return the groups
                } else {
                    console.warn("Unexpected response format:", response);
                    throw new Error("Invalid response format received from server.");
                }
            } catch (error) {
                // Log the error for debugging purposes
                console.error(`Error fetching group configuration for phase ${phaseId}:`, error);
                return []; // Return an empty array in case of an error
            }
        },

        getChatMessageCount: async function(phaseId) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/phases/${phaseId}/message_count`);
                
                // Check if the response data is valid and contains the expected "messages" field
                if (response && response.data && Array.isArray(response.messageCount)) {
                    return response.messageCount; // Return the list of message counts
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
            try {
                const response = await $http.get(`/phases/${phaseId}/stats`);
                return response?.data;
            } catch (error) {
                if (error.status === 404) {
                    console.error(`Phase stats not found for phaseId: ${phaseId}`);
                    throw new Error("Phase stats not found.");
                } else if (error.status === 400) {
                    console.error(`Bad request for phaseId: ${phaseId}`);
                    throw new Error("Invalid request for phase stats.");
                } else {
                    console.error("Unexpected error fetching phase stats:", error);
                    throw new Error("An unexpected error occurred.");
                }
            }
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
        addItemsToPhase: async function(phaseId, phaseItems) {
            try {
                // TODO: refactor the backend endpoint so that it can receive a list of
                // items...
                // Iterate over the phase items and make HTTP POST requests for each item
                await Promise.all(
                    phaseItems.map(item => {
                        return $http({
                            url: `/phases/${phaseId}/items`,
                            method: "POST",
                            data: item
                        });
                    })
                );
                console.info(`Items successfully added to phase ${phaseId}`);
            } catch (error) {
                console.error(`Failed to add items to phase ${phaseId}:`, error);
                throw new Error("Error adding items to phase.");
            }
        },
    };

    return service; 
};

const responseMergeHandlers = {
    ranking: rankingResponseMerger,
    semantic_differential : semanticDifferentialResponseMerger
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
