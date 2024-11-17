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

        async createActivity(sessionId, designId) {
            try {
                const postdata = { sesid: sessionId, dsgnid: designId };            
                const response = await $http({ 
                    url: "add-activity", 
                    method: "post", 
                    data: postdata 
                });
            }
            catch (error) {
                const msg = "[ActivityCatalogService::createActivity] Error creating activity:";
                throw new Error(msg);
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
