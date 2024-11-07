let ActivityStateService = ($http) => {
    var service = {};
    service.activityDescriptor = {
        phaseInformation:        [],
        phases:                  [],
        id:                      null,
        title:                   null,
        type:                    null,
        dashboardAutoreload:     true,
        dashboardAutoreloadTime: 15 
    };

    service.sessionDescriptor = {
        id: null,
        name: "",
        descr: "",
        status: 0,
        type: '' 
    };

    service.setSessionDescriptor = (sd) => {
        service.sessionDescriptor = { ...service.sessionDescriptor, ...sd };
    }

    // Method to load activity phases based on session id
    service.loadActivityPhases = () => {
        const sesid = service.sessionDescriptor.id;

        // Log the beginning of the function call
        console.log(`[ActivityStateService::loadActivityPhases] start with sesid: ${sesid}`);

        // Prepare request payload
        console.debug(`[ActivityStateService::loadActivityPhases] sessionDescriptor.id: ${service.sessionDescriptor.id}`);
        const postData = { sesid: service.sessionDescriptor.id };

        // Make HTTP request to fetch admin stages
        return $http({
            url: "get-admin-stages",
            method: "post",
            data: postData
        })
        .then((response) => {
            console.log(
                `[ActivityStateService::loadActivityPhases] response: ${JSON.stringify(response)}`);

            // Assign received stages data to `service.activityState.phases`
            service.activityDescriptor.phases = response.data;

            // Populate `phaseInformation` within `activityState` with stage details
            service.activityDescriptor.phaseInformation = response.data.map(stage => ({
                name: `Stage ${stage.number}`,
                val: stage.id
            }));
            
            console.log(`[ActivityStateService::loadActivityPhases] phaseInformation: ${JSON.stringify(service.activityDescriptor.phaseInformation)}`);

            // Return phases data if further handling is required
            return service.activityDescriptor.phases;
        })
        .catch((error) => {
            console.error("[ActivityStateService::loadActivityPhases] Error fetching admin stages:",
                error);
            throw error;
        });
    };

    return service; 
};

export { ActivityStateService };
