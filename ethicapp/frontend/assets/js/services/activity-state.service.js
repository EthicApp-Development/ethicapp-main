import { isSessionEvent, nextPhaseClock } from "../helpers/phase-clock-state.js";
import {
    TRANSITION_ACTIONS,
    phaseTransitionAction,
    phaseTransitionNotice,
} from "../helpers/phase-transition-sync.js";

// `now` is for tests; AngularJS injects the first two.
let ActivityStateService = function($http, TeacherSocketService, now = () => Date.now()) {
    const CHAT_NOTIFY_THROTTLE_MS = 3000;
    const CHAT_REFRESH_WATCHDOG_MS = 10000;

    // Per activity (#1116): this dashboard's requests to start the next
    // phase still running, a phase transition that arrived meanwhile, and
    // the queue that runs the reads after a transition or a reconnect one at
    // a time, so each new phase is read once.
    const phaseSyncs = new Map();
    const phaseSync = function(sessionId) {
        const key = Number(sessionId);
        if (!phaseSyncs.has(key)) {
            phaseSyncs.set(key, { ownStarts: 0, deferred: null, queue: Promise.resolve() });
        }
        return phaseSyncs.get(key);
    };
    const enqueuePhaseSync = function(sessionId, task) {
        const sync = phaseSync(sessionId);
        sync.queue = sync.queue.then(task).catch((error) => {
            console.error(
                `[ActivityStateService] Failed to follow the phases of session ${sessionId}:`,
                error);
        });
        return sync.queue;
    };

    // The latest phase clock of each activity (#1116), with its server
    // offset: see getPhaseClock.
    const phaseClocks = new Map();

    const service = {
        subscriptionsMap: new Map(), // Subscription to socket events
        chatNotificationState: new Map(),
        chatRefreshIntervals: new Map(),
        activityStates: {}, // Activity states
        listeners: {}, // Subscribed listeners
        rankingResponseMerger: async function(sessionId, response, responses) {
            const phases = await service.getInstancedPhases(sessionId, false);
            const phaseNumber = phases.find((phase) =>
                Number(phase.id) === Number(response.phaseId)
            )?.number;

            if (phaseNumber === undefined || phaseNumber === null) {
                console.warn(`[ActivityStateService] Could not resolve phaseNumber for ranking response in session ${sessionId}.`, {
                    phaseId: response.phaseId,
                    phases,
                });
                return;
            }

            let phaseResponses = responses.find(
                (prs) => Number(prs.phase_number) === Number(phaseNumber)
            );

            if (!phaseResponses) {
                phaseResponses = {
                    phase_number: phaseNumber,
                    responses: [],
                };
                responses.push(phaseResponses);
            }

            const responseItems = Array.isArray(response.items) ? response.items : [];
            responseItems.forEach((item) => {
                const existingResponse = phaseResponses.responses.find(resp =>
                    Number(resp.uid) === Number(response.uid) &&
                    Number(resp.actorid) === Number(item.actorid)
                );

                if (existingResponse) {
                    existingResponse.orden = item.orden;
                    existingResponse.description = item.description;
                } else {
                    phaseResponses.responses.push({
                        uid: response.uid,
                        actorid: item.actorid,
                        orden: item.orden,
                        description: item.description,
                    });
                }
            });
        },
        semanticDifferentialResponseMerger: async function(sessionId, response, responses) {
            const phases = await service.getInstancedPhases(sessionId, false);
            const phaseNumber = phases.find((phase) =>
                Number(phase.id) === Number(response.phaseId)
            )?.number;

            if (phaseNumber === undefined || phaseNumber === null) {
                console.warn(`[ActivityStateService] Could not resolve phaseNumber for semantic_differential response in session ${sessionId}.`, {
                    phaseId: response.phaseId,
                    phases,
                });
                return;
            }

            const phaseResponses = responses.find(
                (prs) => Number(prs.phase_number) === Number(phaseNumber)
            );

            const existingResponse = phaseResponses?.responses.find(resp => resp.uid === response.uid
                && resp.did == response.did);

            if (existingResponse) {
                existingResponse.comment = response.comment;
                existingResponse.sel = response.sel;
            } else {
                const { type, ...responseWithoutType } = response;
                if (!phaseResponses) {
                    responses.push({
                        phase_number: phaseNumber,
                        responses: [responseWithoutType]
                    });
                }
                else {
                    phaseResponses.responses.push(responseWithoutType);
                }
            }
        },
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

                // the phase clock (#1116); the activity loads without it
                await service.refreshPhaseClock(sessionId);
        
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
            
            console.log(`Subscribing to activity events for session ${sessionId}...`);
            
            // Subscribe to `onStudentJoined`
            subscriptions.push(
                TeacherSocketService.fromEvent('onStudentJoined').subscribe({
                    next: async (data) => {
                        console.debug(`Peer joined session ${sessionId}:`, 
                            JSON.stringify(data));

                        const activityState = service.activityStates[sessionId] || {};
                        const userList = Array.isArray(activityState.users) ? activityState.users : [];
                        service.activityStates[sessionId].users = userList;

                        const existingUser = userList.find((user) =>
                            Number(user.id) === Number(data.id)
                        );

                        if (!existingUser) {
                            userList.push({
                                id: data.id,
                                name: data.name,
                                role: data.role || "A",
                                mail: data.mail,
                                device: data.device,
                            });
                        }

                        // Notify listeners
                        service.notifyListeners("onStudentJoined", {
                            response: data
                        });
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
                        try {
                            console.debug(`[ActivityStateService] onResponseSubmitted received for session ${sessionId}:`, data);
                            const handler = service.responseMergeHandlers[data.type];
                            
                            if (!handler) {
                                const msg = `[ActivityStateService] No handler available for incoming response type '${data.type}'`;
                                console.error(msg, data);
                                return;
                            }

                            // If this is the first response, fetch the responses, including the
                            // one that just arrived. That is, have the API conform the appropriate data
                            // structure to accommodate the next responses that arrive.
                            if (!service.activityStates[sessionId].responses) {
                                // load activity responses
                                await service.getResponses(sessionId, true);
                            }

                            await handler(sessionId, data, service.activityStates[sessionId].responses);

                            console.debug(`Response submitted for session ${sessionId}:`, 
                                JSON.stringify(data));
                            console.debug(`About to notify listeners ${JSON.stringify(data)}:`);
        
                            service.notifyListeners("onResponseSubmitted", { 
                                response: data
                            });
                        } catch (error) {
                            console.error(`[ActivityStateService] Failed to process onResponseSubmitted for session ${sessionId}:`, error);
                        }
                    },
                    error: (err) => console.error(`Websocket error for responseSubmitted in session ${sessionId}:`, err),
                })                
            );
        
            // Subscribe to `onExternalServiceInstantiated` (#865): an AI service
            // reported an instantiation, such as the mode of a new tutor
            // session. Listeners read what they need again.
            subscriptions.push(
                TeacherSocketService.fromEvent("onExternalServiceInstantiated").subscribe({
                    next:  data => service.notifyListeners("onExternalServiceInstantiated", data),
                    error: err => console.error(
                        `Websocket error for onExternalServiceInstantiated in session ${sessionId}:`, err),
                })
            );

            service.startChatRefreshWatchdog(sessionId);

            // Subscribe to `onChatMessage`
            subscriptions.push(
                TeacherSocketService.fromEvent('onChatMessage').subscribe({
                    next: (data) => {
                        console.debug(`New chat message ${sessionId}:`, data);
                        service.handleChatMessageNotification(sessionId, data);
                    },
                    error: (err) => console.error(`Websocket error for phaseChanged in session ${sessionId}:`, err),
                })
            );
        
            // The phase events (#1116, epic #1105). The teacher's socket may be
            // in the rooms of several activities, so each one is checked
            // against this session.
            subscriptions.push(
                TeacherSocketService.fromEvent("onPhaseTransition").subscribe({
                    next:  data => service.handlePhaseTransition(sessionId, data),
                    error: err => console.error(
                        `Websocket error for onPhaseTransition in session ${sessionId}:`, err),
                })
            );
            subscriptions.push(
                TeacherSocketService.fromEvent("onPhaseClock").subscribe({
                    next:  data => service.acceptPhaseClock(sessionId, data),
                    error: err => console.error(
                        `Websocket error for onPhaseClock in session ${sessionId}:`, err),
                })
            );
            subscriptions.push(
                TeacherSocketService.fromEvent("onPhaseDeadlineReached").subscribe({
                    next: (data) => {
                        if (isSessionEvent(data, sessionId)) {
                            service.notifyListeners("onPhaseDeadlineReached", data);
                        }
                    },
                    error: err => console.error(
                        `Websocket error for onPhaseDeadlineReached in session ${sessionId}:`, err),
                })
            );

            // After a reconnect the socket service joins the session's room
            // again; what happened meanwhile is read again here.
            const stopFollowingReconnects = typeof TeacherSocketService.onReconnect === "function"
                ? TeacherSocketService.onReconnect(() => service.resyncAfterReconnect(sessionId))
                : () => {};

            // Function to unsubscribe all subscriptions
            const unsubscribeAll = () => {
                subscriptions.forEach((subscription) => subscription.unsubscribe());
                stopFollowingReconnects();
                TeacherSocketService.leaveSession(sessionId);
                service.stopChatRefreshWatchdog(sessionId);
                service.clearChatNotificationState(sessionId);
                phaseClocks.delete(Number(sessionId));
                phaseSyncs.delete(Number(sessionId));
                service.subscriptionsMap.delete(sessionId); // Remove from the map
            };
        
            // Store the subscriptions in the map
            service.subscriptionsMap.set(sessionId, { subscriptions, unsubscribeAll });
        
            return unsubscribeAll; // Return the unsubscribe function
        },

        handleChatMessageNotification: function(sessionId, data) {
            const phaseId = Number(data?.phaseId);
            if (!phaseId) {
                console.warn("[ActivityStateService] Received chat notification without phaseId.", data);
                return;
            }

            const notificationKey = `${sessionId}:${phaseId}`;
            const now = Date.now();
            const state = service.chatNotificationState.get(notificationKey) || {
                lastNotifiedAt: 0,
                trailingTimeoutId: null,
                latestData: null,
            };

            state.latestData = data;
            const elapsed = now - state.lastNotifiedAt;

            if (elapsed >= CHAT_NOTIFY_THROTTLE_MS) {
                if (state.trailingTimeoutId) {
                    clearTimeout(state.trailingTimeoutId);
                    state.trailingTimeoutId = null;
                }

                service.emitChatDashboardRefresh(sessionId, phaseId, data, "socket");
                state.lastNotifiedAt = now;
                service.chatNotificationState.set(notificationKey, state);
                return;
            }

            if (!state.trailingTimeoutId) {
                state.trailingTimeoutId = setTimeout(() => {
                    const latestState = service.chatNotificationState.get(notificationKey);
                    if (!latestState) {
                        return;
                    }

                    latestState.trailingTimeoutId = null;
                    latestState.lastNotifiedAt = Date.now();
                    service.emitChatDashboardRefresh(
                        sessionId,
                        phaseId,
                        latestState.latestData,
                        "socket-trailing"
                    );
                    service.chatNotificationState.set(notificationKey, latestState);
                }, CHAT_NOTIFY_THROTTLE_MS - elapsed);
            }

            service.chatNotificationState.set(notificationKey, state);
        },

        emitChatDashboardRefresh: function(sessionId, phaseId, data, reason) {
            service.notifyListeners("onChatMessage", {
                ...data,
                sessionId,
                phaseId,
                refreshReason: reason,
            });
        },

        startChatRefreshWatchdog: function(sessionId) {
            if (service.chatRefreshIntervals.has(sessionId)) {
                return;
            }

            const intervalId = setInterval(() => {
                const activityState = service.activityStates[sessionId];
                const descriptor = activityState?.descriptor;
                const currentPhase = descriptor?.currentPhase;
                const currentPhaseDescriptor = descriptor?.phases?.find((phase) =>
                    Number(phase.id) === Number(currentPhase?.id)
                ) || currentPhase;

                if (!currentPhase || descriptor?.status === "finished" || !currentPhaseDescriptor?.chat) {
                    return;
                }

                const phaseId = Number(currentPhase.id);
                const notificationKey = `${sessionId}:${phaseId}`;
                const state = service.chatNotificationState.get(notificationKey);
                const lastNotifiedAt = state?.lastNotifiedAt || 0;

                if (Date.now() - lastNotifiedAt >= CHAT_REFRESH_WATCHDOG_MS) {
                    service.emitChatDashboardRefresh(sessionId, phaseId, {
                        phaseId,
                    }, "watchdog");
                    service.chatNotificationState.set(notificationKey, {
                        ...(state || {}),
                        lastNotifiedAt: Date.now(),
                        trailingTimeoutId: state?.trailingTimeoutId || null,
                        latestData: state?.latestData || null,
                    });
                }
            }, CHAT_REFRESH_WATCHDOG_MS);

            service.chatRefreshIntervals.set(sessionId, intervalId);
        },

        stopChatRefreshWatchdog: function(sessionId) {
            const intervalId = service.chatRefreshIntervals.get(sessionId);
            if (intervalId) {
                clearInterval(intervalId);
                service.chatRefreshIntervals.delete(sessionId);
            }
        },

        clearChatNotificationState: function(sessionId) {
            const prefix = `${sessionId}:`;
            Array.from(service.chatNotificationState.entries()).forEach(([key, state]) => {
                if (!key.startsWith(prefix)) {
                    return;
                }

                if (state?.trailingTimeoutId) {
                    clearTimeout(state.trailingTimeoutId);
                }

                service.chatNotificationState.delete(key);
            });
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
                    
                    if (response?.data?.descriptor) {
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

        // The pseudonym numbers of the activity's students (#897), which the
        // dashboard shows in place of their names while the teacher hides
        // them: `[{ userId, number }]`. Each call assigns a number to the
        // students who joined since the last one. Only the activity's owner
        // may read them. Throws when they cannot be read.
        getParticipantPseudonyms: async function(sessionId) {
            const response = await $http.get(`/sessions/${sessionId}/pseudonyms`);
            if (!Array.isArray(response?.data?.pseudonyms)) {
                throw new Error("Invalid response format received from server.");
            }
            return response.data.pseudonyms;
        },

        getChatMessageCount: async function(phaseId) {
            try {
                // Make the HTTP GET request to the endpoint
                const response = await $http.get(`/phases/${phaseId}/message_count`);
                
                // Check if the response data is valid and contains the expected "messages" field
                if (response && response.data && Array.isArray(response.data.messageCount)) {
                    return response.data.messageCount; // Return the list of message counts
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
                const response = await $http.get(`/groups/${groupId}/question/${questionId}/chat_messages`);
                
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

        getGroupResponses: async function(groupId, phaseId) {
            try {
                const response = await $http.get(`/groups/${groupId}/responses`, {
                    params: { phase_id: phaseId },
                });

                if (response?.data && Array.isArray(response.data.responses)) {
                    return response.data.responses;
                }

                console.warn("Unexpected response format:", response);
                return [];
            } catch (error) {
                console.error(`Error fetching responses for group ${groupId} in phase ${phaseId}:`, error);
                return [];
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
        /**
         * Starts the activity's next phase on the server (#906), which builds it
         * from the stored design in one transaction, then reloads the phases,
         * the descriptor and the responses. When the activity is no longer at
         * `expectedPhaseNumber` (409, another tab or request moved it first),
         * they are reloaded too, so the dashboard shows where it is, and the
         * error is thrown.
         *
         * @param {number|string} sessionId
         * @param {number} expectedPhaseNumber The current phase's number, 0
         *   before the first phase.
         * @returns {Promise<{ id: number, number: number }>} The new phase.
         */
        startNextPhase: async function(sessionId, expectedPhaseNumber) {
            // While it runs, the `onPhaseTransition` of this very start is
            // held, and checked again once the phases are read (#1116).
            const sync = phaseSync(sessionId);
            sync.ownStarts += 1;
            try {
                let response;
                try {
                    response = await $http.post(`/activities/${sessionId}/phases/next`, {
                        expectedPhaseNumber,
                    });
                } catch (error) {
                    if (error?.status === 409) {
                        await service.reloadPhaseState(sessionId).catch((reloadError) => {
                            console.error(`Failed to reload the phases of session ${sessionId}:`,
                                reloadError);
                        });
                    }
                    throw error;
                }

                await service.reloadPhaseState(sessionId);
                return response.data.phase;
            } finally {
                sync.ownStarts -= 1;
                if (sync.ownStarts === 0 && sync.deferred) {
                    const deferred = sync.deferred;
                    sync.deferred = null;
                    service.handlePhaseTransition(sessionId, deferred);
                }
            }
        },

        /**
         * Follows a phase that started (#1116): `onPhaseTransition { sessionId,
         * phaseId, phaseNumber, reason }`, from the deadline runner or from a
         * teacher's request in any dashboard of the activity. A phase this
         * dashboard does not know yet makes it read the phases, the
         * descriptor and the responses once, then notifies the listeners of
         * `onPhaseTransition` with the phase the activity is at and the
         * event's reason (helpers/phase-transition-sync.js). This
         * dashboard's own start is not read twice.
         *
         * @returns {Promise<void>}
         */
        handlePhaseTransition: function(sessionId, event) {
            return enqueuePhaseSync(sessionId, async () => {
                const sync = phaseSync(sessionId);
                const action = phaseTransitionAction(event, {
                    sessionId,
                    descriptor:      service.activityStates[sessionId]?.descriptor,
                    ownStartPending: sync.ownStarts > 0,
                });
                if (action === TRANSITION_ACTIONS.DEFER) {
                    sync.deferred = event;
                    return;
                }
                if (action !== TRANSITION_ACTIONS.APPLY) {
                    return;
                }

                await service.reloadPhaseState(sessionId);
                const notice = phaseTransitionNotice(sessionId,
                    service.activityStates[sessionId]?.descriptor, event.reason);
                if (notice) {
                    service.notifyListeners("onPhaseTransition", notice);
                }
            });
        },

        /**
         * Reads the activity again after the socket reconnected (#1116): the
         * participants, the phases, the descriptor, the responses and the
         * clock, since events may have been missed. Notifies
         * `onPhaseTransition` (reason null) when the activity moved to
         * another phase meanwhile, then `onActivityResynced { sessionId }`.
         *
         * @returns {Promise<void>}
         */
        resyncAfterReconnect: function(sessionId) {
            return enqueuePhaseSync(sessionId, async () => {
                const state = service.activityStates[sessionId];
                if (!state) {
                    return;
                }
                const phaseBefore = Number(state.descriptor?.currentPhase?.id) || null;

                await service.getSessionUsers(sessionId, true);
                await service.reloadPhaseState(sessionId);
                await service.refreshPhaseClock(sessionId);

                const notice = phaseTransitionNotice(sessionId,
                    service.activityStates[sessionId]?.descriptor, null);
                if (notice && notice.phaseId !== phaseBefore) {
                    service.notifyListeners("onPhaseTransition", notice);
                }
                service.notifyListeners("onActivityResynced", { sessionId: Number(sessionId) });
            });
        },

        /**
         * The latest phase clock of an activity (#1116, epic #1105), or null
         * before it is read. Its fields are the server's (GET
         * /activities/:id/clock and `onPhaseClock`, documented in
         * backend/helpers/phase-clock.js) plus `offsetMs`, the server's time
         * minus the local time when it arrived, and `receivedAt`, that local
         * time in ms (helpers/phase-clock-state.js). Listeners of
         * `onPhaseClock` get it each time it changes.
         *
         * @param {number|string} sessionId
         * @returns {Object|null}
         */
        getPhaseClock: function(sessionId) {
            return phaseClocks.get(Number(sessionId)) ?? null;
        },

        /**
         * Keeps `clock` as the activity's phase clock unless it is for
         * another activity or older than the one kept, and then notifies the
         * listeners of `onPhaseClock`.
         *
         * @returns {boolean} Whether it was kept.
         */
        acceptPhaseClock: function(sessionId, clock) {
            const { accepted, clock: kept } = nextPhaseClock(service.getPhaseClock(sessionId),
                clock, { sessionId, localNowMs: now() });
            if (!accepted) {
                return false;
            }
            phaseClocks.set(Number(sessionId), kept);
            service.notifyListeners("onPhaseClock", kept);
            return true;
        },

        /**
         * Reads the activity's phase clock from the server. A failure is
         * logged and keeps the clock already kept.
         *
         * @returns {Promise<Object|null>} The kept clock.
         */
        refreshPhaseClock: async function(sessionId) {
            try {
                const response = await $http.get(`/activities/${sessionId}/clock`);
                service.acceptPhaseClock(sessionId, response?.data);
            } catch (error) {
                console.error(`Failed to read the phase clock of session ${sessionId}:`, error);
            }
            return service.getPhaseClock(sessionId);
        },

        /**
         * Adds one minute to the current phase's deadline (#1115, through
         * the route of #1112). `expectedEndsAt` is the kept clock's
         * `endsAt`: the server adds the minute only while the deadline is
         * still that one, so a double click, or two open dashboards, add it
         * once. The clock in the answer is kept, a success's and a
         * refusal's (409) alike; a refusal without one reads the clock
         * again. Never throws.
         *
         * @param {number|string} sessionId
         * @param {number} phaseId The kept clock's `phaseId`.
         * @param {string} expectedEndsAt The kept clock's `endsAt`.
         * @returns {Promise<{ ok: boolean, code: string|null }>} `code` is
         *   the server's refusal code (DEADLINE_CHANGED, PHASE_NOT_CURRENT,
         *   ACTIVITY_FINISHED, NO_DEADLINE, DEADLINE_PASSED, ...), or null.
         */
        extendPhaseClock: async function(sessionId, phaseId, expectedEndsAt) {
            try {
                const response = await $http.post(
                    `/activities/${sessionId}/phases/${phaseId}/clock/extend`,
                    { minutes: 1, expectedEndsAt });
                service.acceptPhaseClock(sessionId, response?.data);
                return { ok: true, code: null };
            } catch (error) {
                const code = typeof error?.data?.code === "string" ? error.data.code : null;
                if (error?.status === 409) {
                    if (error.data?.clock) {
                        service.acceptPhaseClock(sessionId, error.data.clock);
                    } else {
                        await service.refreshPhaseClock(sessionId);
                    }
                } else {
                    console.error(`Failed to extend the phase clock of session ${sessionId}:`,
                        error);
                }
                return { ok: false, code };
            }
        },

        reloadPhaseState: async function(sessionId) {
            await service.getInstancedPhases(sessionId, true);
            await service.getActivityDescriptor(sessionId, true);
            await service.getResponses(sessionId, true);
        },
    };

    service.responseMergeHandlers = {
        ranking: service.rankingResponseMerger,
        semantic_differential : service.semanticDifferentialResponseMerger
    };

    return service; 
};

export { ActivityStateService };
