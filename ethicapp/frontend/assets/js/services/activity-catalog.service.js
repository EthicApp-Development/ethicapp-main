let ActivityCatalogService = ($http) => {
    const service = {
        activities: [],
        
        getActivities() {
            return service.activities;
        },
        
        async getActivityBySessionId(sessionId, retry = true) {
            // Search locally
            const activity = service.activities.find(activity => activity.session === sessionId);

            // If the activity was not found, and retrying is requested, reload and
            // then find again.
            if (!activity && retry) {
                try {
                    await service.loadActivities();
                    return service.activities.find(activity => activity.session === sessionId) || null;
                } catch (error) {
                    console.error(`Error fetching activity by sessionId: ${sessionId}`, error);
                    throw new Error("Error fetching activity by session ID");
                }
            }

            return activity || null;
        },

        async createActivity(design, description) {
            try {
                console.debug(`[createActivity] ${JSON.stringify(design)})`);

                // Create the session for the activity
                const sessionResponse = await $http({
                    url:    "/sessions",
                    method: "POST",
                    data: { 
                        name: design.metainfo.title, 
                        descr: description, 
                        type: design.type == "semantic_differential" ? "T" : "R", 
                        additionalConfig: {} 
                    }
                });

                const sessionId = sessionResponse.data.id;
                const designId = design.id;
                
                // Create the activity bound to the session
                const response = await $http({
                    url: "/activities",
                    method: "POST",
                    data: { 
                        sesid: sessionId, 
                        dsgnid: designId 
                    }
                });
        
                // Check the response status
                if (response.data.status === "ok" && response.data.activity) {
                    // Add the new activity to the local list
                    service.activities.push(response.data.activity);
        
                    // Notify subscribers of the updated activities list
                    // service.notifySubscribers();
                    return sessionId;
                } else {
                    throw new Error("Unexpected response format or missing activity in response.");
                }
            } catch (error) {
                console.error("[ActivityCatalogService::createActivity] Error creating activity:", error);
                throw new Error("[ActivityCatalogService::createActivity] Failed to create activity.");
            }
        },
        
        async loadActivities() {
            console.log("[ActivityCatalogService::loadActivities]");
            
            try {
                const response = await $http({
                    url: "get-activities",
                    method: "POST",
                    data: {}
                });
                
                // Assign activities or an empty array if response is not as expected
                service.activities = Array.isArray(response.data.activities) ? 
                    response.data.activities : [];
                
                // Map titles from design metadata if present
                service.activities.forEach(activity => {
                    if (activity.design?.metainfo?.title) {
                        activity.title = activity.design.metainfo.title;
                    }
                });
                
                return service.activities;
                
            } catch (error) {
                console.error("[ActivityCatalogService::loadActivities] Error fetching activities:", error);
                service.activities = [];
                return service.activities;
            }
        }
    };

    return service;
};

export { ActivityCatalogService };
