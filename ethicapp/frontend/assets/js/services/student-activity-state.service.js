let StudentActivityStateService = function($http, StudentSocketService) {
    const service = {
        subscriptions: {}, // Subscription to socket events
        activityState: null,
        sessionId: null,
        listeners: {}, // Subscribed listeners
        joinSession: async function(sessionId) {
        },
        loadActivityState: async function() {
            if (!sessionId) {
                console.error("The session Id is not set. Aborting...");
                return;
            }
            await service.getActivityDescriptor(true);
            await service.getInstancedPhases(true);
            await service.getGroups(true);
            await service.loadChatTranscripts();            
        },
        subscribeToActivityEvents: () => {
            // Join the session for the given sessionId
            StudentSocketService.joinSession(sessionId);

            // End all previous subscriptions
            if (typeof service.subscriptions.unsubscribeAll === "function") {
                service.subscriptions.unsubscribeAll();
            }
        
            const eventSubscriptions = [];
            
            // Subscribe to `onPhaseTransition`
            eventSubscriptions.push(
                StudentSocketService.fromEvent('onPhaseTransition').subscribe({
                    next: async (data) => {
                        console.debug(`Transitioning to the next phase: `, 
                            JSON.stringify(data));
                            
                        // Reload the instanced phases
                        // TODO: Insert the incoming phase data into the local, cached data structure.
                        await service.getInstancedPhases(true);

                        // Notify listeners
                        service.notifyListeners("onPhaseTransition", { 
                            response: data });
                    },
                    error: (err) => {
                        console.error(`Websocket error for onPhaseTransition event in session ${service.sessionId}:`, err)
                    }
                })
            );

            // Subscribe to `onGroupMessage`
            eventSubscriptions.push(
                StudentSocketService.fromEvent('onGroupMessage').subscribe({
                    next: async (data) => {
                        console.debug(`Incoming group message: `, 
                            JSON.stringify(data));
                            
                        // TODO: Do something with the incoming group message

                        // Notify listeners
                        service.notifyListeners("onGroupMessage", { 
                            response: data });
                    },
                    error: (err) => {
                        console.error(`Websocket error for onGroupMessage event in session ${service.sessionId}:`, err)
                    }
                })
            );

            // Subscribe to `onShareResponse`
            eventSubscriptions.push(
                StudentSocketService.fromEvent('onShareResponse').subscribe({
                    next: async (data) => {
                        console.debug(`Incoming shared response: `, 
                            JSON.stringify(data));
                            
                        // TODO: Do something with the incoming response

                        // Notify listeners
                        service.notifyListeners("onShareResponse", { 
                            response: data });
                    },
                    error: (err) => {
                        console.error(`Websocket error for onShareResponse event in session ${service.sessionId}:`, err)
                    }
                })
            );

            // Subscribe to `onEndSession`
            eventSubscriptions.push(
                StudentSocketService.fromEvent('onEndSession').subscribe({
                    next: async (data) => {
                        console.debug(`Incoming shared response: `, 
                            JSON.stringify(data));
                            
                        // TODO: Do something with the incoming response

                        // Notify listeners
                        service.notifyListeners("onEndSession", { 
                            response: data });
                    },
                    error: (err) => {
                        console.error(`Websocket error for onEndSession event in session ${service.sessionId}:`, err)
                    }
                })
            );

            // Function to unsubscribe all subscriptions
            const unsubscribeAll = () => {
                eventSubscriptions.forEach((subscription) => subscription.unsubscribe());
                TeacherSocketService.leaveSession(service.sessionId);
            };
        
            // Keep the subscriptions
            service.subscriptions = { eventSubscriptions, unsubscribeAll };
        
            return unsubscribeAll; // Return the unsubscribe function
        },
        getActivityDescriptor: async function(refresh = false) {
            if (!service.sessionId) {
                console.error("[StudentActivityStateService::getActivityDescriptor] Session Id is not set.");
                return {};
            }
            if (refresh) {
                const sessionId = service.sessionId;

                try {
                    const response = await $http.get(`/activities/${sessionId}/descriptor`);
                    
                    if (response?.data?.descriptor) {
                        service.activityState.descriptor = response.data.descriptor;
                    } else {
                        console.warn("Unexpected response format:", response);
                        throw new Error("Invalid response format received from server.");
                    }
                } catch (error) {
                    console.error(`Failed to refresh the activity descriptor for session ${sessionId}:`, error);
                    throw new Error(`Error fetching activity descriptor for session ${sessionId}: ${error.message}`);
                }
            }
        
            return service.activityState.descriptor;
        },
        getInstancedPhases: async function (refresh = false) {
            if (!service.sessionId) {
                console.error("[StudentActivityStateService::getInstancedPhases] Session Id is not set.");
                return {};
            }            

            if (refresh) {
                const sessionId = service.sessionId;

                try {
                    const response = await $http.get(`/activities/${sessionId}/phases`);
                    
                    // Validate response format
                    if (response?.data?.phases && Array.isArray(response.data.phases)) {
                        service.activityState = response.data.phases;
                    } else {
                        console.warn("This activity has no phases yet:", response);
                        service.activityState.phases = []; // Set to an empty array if no phases are found
                    }
                } catch (error) {
                    if (error.status === 404) {
                        console.warn(`No phases found for session ${sessionId}:`, error);
                        service.activityState.phases = []; // Return an empty array if 404 error
                    } else {
                        console.error(`Failed to refresh phase instances for session ${sessionId}:`, error);
                        throw new Error(`Error fetching phases for session ${sessionId}: ${error.message}`);
                    }
                }
            }
        
            return service.activityState.phases;
        },
        getResponses: async function(refresh = false) {

        },
        submitResponse: async function(response) {
            try {
                // TODO: have the endpoint return the id of the response submitted
                const result = await $http.post(`/phases/${phaseId}/responses`, response);
            } catch (error) {
                console.error(
                    `[StudentActivityStateService::submitResponse] Failed to submit response. Session Id:'${service.sessionId}'`);
            }
        },
        getGroups: async function(refresh = false) {

        },
        loadChatTranscripts: async function() {

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
        }
    }

    return service;
};