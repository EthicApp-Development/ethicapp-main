let ActivityCatalogService = ($http) => {
    const service = {
        activities: [],
        
        getActivities() {
            return service.activities;
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
