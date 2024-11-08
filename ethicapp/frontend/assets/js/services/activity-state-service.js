// ActivityStateService currently handles the state of a single activity, i.e.,
// the one being monitored or worked on currently by the user.
let ActivityStateService = ($http) => {
    const service = {
        activityDescriptor: {
            phaseInformation: [],
            phases: [],
            activePhase: 0,
            id: null,
            title: null,
            type: null,
            dashboardAutoreload: true,
            dashboardAutoreloadTime: 15,
            designDescriptor: 
                {
                    designId : 0,
                    designObject: {}
                }
        },

        sessionDescriptor: {
            id: 0,
            name: "",
            descr: "",
            status: 0,
            type: ''
        },

        setSessionDescriptor: (sd) => {
            Object.keys(service.sessionDescriptor).forEach(key => {
                delete service.sessionDescriptor[key];
            });        
            Object.keys(sd).forEach(key => {
                service.sessionDescriptor[key] = sd[key];
            });
        },
        
        setDesign: (designId, designObj) => {
            service.activityDescriptor.designDescriptor.designId = designId;
            service.activityDescriptor.designDescriptor.designObject = designObj;
        },

        getDesignObj: () => {
            return service.activityDescriptor.designDescriptor.designObject;
        },

        getDesignId: () => {
            return service.activityDescriptor.designDescriptor.designId;
        },

        async loadActivityPhases() {
            const sesid = service.sessionDescriptor.id;
            console.log(`[ActivityStateService::loadActivityPhases] Starting with sesid: ${sesid}`);

            // Prepare the request payload
            const postData = { sesid };

            try {
                // Make HTTP request to fetch admin stages
                const response = await $http({
                    url: "get-admin-stages",
                    method: "post",
                    data: postData
                });
                
                console.log(`[ActivityStateService::loadActivityPhases] Response received`);

                // Assign the stages to `phases`
                service.activityDescriptor.phases = response.data;

                // Map stage details to `phaseInformation`
                service.activityDescriptor.phaseInformation = response.data.map(stage => ({
                    name: `Stage ${stage.number}`,
                    val: stage.id
                }));

                console.log(`[ActivityStateService::loadActivityPhases] Updated phaseInformation: ${JSON.stringify(service.activityDescriptor.phaseInformation)}`);

                return service.activityDescriptor.phases;
            } catch (error) {
                console.error("[ActivityStateService::loadActivityPhases] Error fetching admin stages:", error);
                throw error;
            }
        }
    };

    return service; 
};

export { ActivityStateService };
