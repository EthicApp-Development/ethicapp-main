let StudentActivityStateService = function($http, StudentSocketService) {
    const service = {
        subscriptions: {}, // Subscription to socket events
        activityState: null,
        sessionId: null,
        userId: null,
        listeners: {}, // Subscribed listeners
        joinSession: async function(sessionId, userId) {
            service.sessionId = sessionId;
            service.userId = userId;
            return service.subscribeToActivityEvents();
        },
        leaveSession: async function(sessionId) {
            if (sessionId !== service.sessionId) {
                console.warn(
                    `[StudentActivityStateService::leaveSession] I was asked to leave a session '${sessionId}' that does not match the current one '${service.sessionId}'. Aborting...`
                );
                return;
            }
            // End all previous subscriptions
            if (typeof service.subscriptions.unsubscribeAll === "function") {
                service.subscriptions.unsubscribeAll();
            }
            
            const sesId = service.sessionId;
            service.sessionId = null;
            service.activityState = null;

            service.notifyListeners("onLeftSession", { sesId });
        },
        subscribeToActivityEvents: () => {
            // Join the session for the given sessionId
            StudentSocketService.joinSession(service.sessionId);

            const eventSubscriptions = [];
            
            // Subscribe to `onPhaseTransition`
            eventSubscriptions.push(
                StudentSocketService.fromEvent('onPhaseTransition').subscribe({
                    next: async (data) => {
                        const newPhase = data.phase;

                        if (!newPhase || !newPhase.id) {
                            console.warn("Invalid phase data received:", newPhase);
                            return;
                        }

                        // Add the incoming phase to the local state if not present yet
                        const phaseExists = service.activityState.phases.some(
                            phase => phase.id === newPhase.id
                        );
                        
                        if (!phaseExists) {
                            service.activityState.phases.push(newPhase);
                            console.debug(`Added new phase to the local state:`, newPhase);
                        } else {
                            console.debug(`Phase already exists in the local state:`, newPhase.id);
                        }

                        // Notify listeners
                        service.notifyListeners("onPhaseTransition", { 
                            params: newPhase });
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
                            
                        if (service.activityState) {
                            const lastPhaseIndex = service.activityState.phases.length - 1;
                            service.activityState.phases[lastPhaseIndex].groupMessages.push();
                        }
                        // TODO: Do something with the incoming group message

                        // Resolve the current phase in the session

                        // Place the message within the list pertaining to the message (task)

                        // Notify listeners
                        service.notifyListeners("onGroupMessage", { 
                            params: data });
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
                            params: data });
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
                            params: data });
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
        loadActivityState: async function({ refresh = false, invalidateCache = false }) {
            if (!service.sessionId || !StudentSocketService.userId) {
                console.error("Session ID or User ID is missing.");
                return;
            }

            const params = {
                refresh,
                invalidate: invalidateCache
            };

            try {
                const response = await $http.get(`/activities/${service.sessionId}/users/${service.userId}/full_state`, {
                    params
                });

                if (response.status === 200 && response.data.state) {
                    console.debug("Activity state successfully loaded:", response.data.state);
                    service.activityState = response.data.state;
                    service.notifyListeners("onStateLoaded", service.activityState); // Notify listeners about state change
                } else {
                    console.warn("Activity state response is not as expected:", response);
                }
            } catch (error) {
                console.error("Failed to load activity state:", error);
            }
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
        sendMessageToGroup: function(groupId, itemId, message) {
            // Send the message via WS to the group
            StudentSocketService.emitEvent("messageToGroup", {
                header: {
                    userId: service.userId,
                    groupId,
                    phaseId: service.activityState.currentPhaseId,
                    phaseNumber: service.activityState.currentPhaseNumber,
                    itemId
                },
                payload: {
                    ...message
                }
            });
        },
        loadPeerResponses: async function(phases, refresh = false) {
            if (!service.sessionId || !StudentSocketService.userId) {
                console.error("Session ID or User ID is missing.");
                return [];
            }

            if (!Array.isArray(phases) || phases.length === 0) {
                console.error("Invalid phases parameter. Must be a non-empty array.");
                return [];
            }

            const params = { refresh };

            try {
                const response = await $http.get(`/activities/${service.sessionId}/users/${service.userId}/peer_responses`, {
                    params,
                    data: { phases } // Send phases as the request body
                });

                if (response.status === 200 && response.data.status === 'ok') {
                    console.debug("Peer responses successfully loaded:", response.data.phases);
                    return response.data.phases;
                } else {
                    console.warn("Unexpected response when loading peer responses:", response);
                    return [];
                }
            } catch (error) {
                console.error("Failed to load peer responses:", error);
                return [];
            }
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