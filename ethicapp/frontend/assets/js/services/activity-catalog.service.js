// A failed launch (#972): which request failed (`stage`, "session" or
// "activity"), its HTTP `status` (null without a response) and the server's
// error `code`, if any.
export class LaunchActivityError extends Error {
    constructor(stage, cause) {
        super(`Failed to launch the activity (${stage}).`, { cause });
        this.name = "LaunchActivityError";
        this.stage = stage;
        this.status = Number.isInteger(cause?.status) && cause.status > 0 ? cause.status : null;
        this.code = typeof cause?.data?.code === "string" ? cause.data.code : null;
    }
}

let ActivityCatalogService = ($http) => {
    const service = {
        activities: [],
        listeners: {}, // Subscribed listeners

        // Session id -> services that will not run, from the launch response
        // (#815). The activity dashboard shows them once.
        launchNotices: new Map(),

        // The services the launched design enables that will not run in this
        // activity (#815), once: the notice is consumed when read.
        takeLaunchNotice(sessionId) {
            const key = Number(sessionId);
            const services = service.launchNotices.get(key) || [];
            service.launchNotices.delete(key);
            return services;
        },
        
        getActivities() {
            return service.activities;
        },
        
        async getActivityBySessionId(sessionId, retry = true) {
            const normalizedSessionId = Number(sessionId);
            // Search locally
            const activity = service.activities.find((activityItem) => {
                return Number(activityItem.sessionId) === normalizedSessionId;
            });

            // If the activity was not found, and retrying is requested, reload and
            // then find again.
            if (!activity && retry) {
                try {
                    await service.loadActivities();
                    return service.activities.find((activityItem) => {
                        return Number(activityItem.sessionId) === normalizedSessionId;
                    }) || null;
                } catch (error) {
                    console.error(`Error fetching activity by sessionId: ${sessionId}`, error);
                    throw new Error("Error fetching activity by session ID");
                }
            }

            return activity || null;
        },

        // Launches an activity from `design`: POST /sessions with the
        // design's title and `description`, then POST /activities. With
        // `aiServices: false` the activity runs without the design's AI
        // services (#970); otherwise the field is left out and they stay on.
        // Resolves with the session id. A failure rejects with a
        // LaunchActivityError naming the request that failed (`stage`:
        // "session" or "activity"), its HTTP `status` and the server's `code`,
        // so the launch wizard can say what went wrong (#972).
        async createActivity(design, description, { aiServices } = {}) {
            let stage = "session";
            try {
                // Create the session for the activity
                const sessionResponse = await $http({
                    url:    "/sessions",
                    method: "POST",
                    data: { 
                        name: design.metainfo.title, 
                        description: description, 
                        type: design.type == "semantic_differential" ? "T" : "R", 
                        additionalConfig: {} 
                    }
                });

                const sessionId = sessionResponse.data.id;
                const designId = design.id;
                
                // Create the activity bound to the session
                stage = "activity";
                const activityRequest = { sessionId, designId };
                if (aiServices === false) {
                    activityRequest.aiServices = false;
                }
                const response = await $http({
                    url:    "/activities",
                    method: "POST",
                    data:   activityRequest,
                });
        
                // Check the response status
                if (response.data.status === "ok" && response.data.activity) {
                    // Add the new activity to the local list
                    service.activities.push(response.data.activity);

                    const servicesNotRunning = Array.isArray(response.data.servicesNotRunning)
                        ? response.data.servicesNotRunning
                        : [];
                    if (servicesNotRunning.length > 0) {
                        service.launchNotices.set(Number(sessionId), servicesNotRunning);
                    }
        
                    // Notify subscribers of the updated activities list
                    service.notifyListeners("onActivityCatalogUpdated", { 
                        response: null });
                    
                    return sessionId;
                } else {
                    throw new Error("Unexpected response format or missing activity in response.");
                }
            } catch (error) {
                console.error("[ActivityCatalogService::createActivity] Error creating activity:", error);
                throw new LaunchActivityError(stage, error);
            }
        },
        
        async loadActivities() {
            try {
                const response = await $http({
                    url: "/activities",
                    method: "GET",
                    data: {}
                });
                
                // Assign activities or an empty array if response is not as
                // expected. Each activity carries its design's id and title
                // (`designId`, `designTitle`), not the design document (#1055).
                service.activities = Array.isArray(response.data.activities) ?
                    response.data.activities : [];

                service.notifyListeners("onActivityCatalogUpdated", { 
                    response: null });

                return service.activities;
                
            } catch (error) {
                console.error("[ActivityCatalogService::loadActivities] Error fetching activities:", error);
                service.activities = [];
                return service.activities;
            }
        },

        // Archives (`archived` true) or restores (false) the activity of
        // session `sessionId` (#1048), and updates the cached activity with
        // the flag the server answers. Resolves with `{ id, archived }`. A
        // failure rejects with the $http rejection, whose status and
        // `data.code` say why: 409 ACTIVITY_NOT_FINISHED for an activity that
        // is not finished.
        async setArchived(sessionId, archived) {
            const response = await $http({
                method: "PATCH",
                url:    `/activities/${sessionId}/archive`,
                data:   { archived: archived === true },
            });

            const result = response.data?.result;
            const activity = service.activities
                .find(act => Number(act.sessionId) === Number(sessionId));
            if (activity) {
                activity.archived = result?.archived === true;
            }

            service.notifyListeners("onActivityCatalogUpdated", {
                response: null });

            return result;
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
    };

    return service;
};

export { ActivityCatalogService };
