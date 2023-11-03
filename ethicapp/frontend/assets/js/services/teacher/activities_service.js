import * as apiMod from "./activities_service/api_object_factory.js";

export let ActivitiesService = ($rootScope, $http) => {
    var service = { };
    service.activities = [];

    service.init = () => {
        self.loadActivities();
        service.clearCurrentActivity();
    };

    service.clearCurrentActivity = () => {
        service.currentActivity = {
            designId:     null,
            title:        null,
            type:         null,
            currentPhase: -1
        };
    };
    
    service.setCurrentActivityById = (activityId) => {
        // Assign fields to activity object
        let act = service.lookUpActivity(activityId).then(result => {
            // Strip current activity object
            Object.keys(service.currentActivity).forEach(key => delete obj[key]);

            // Copy the fields
            Object.assign(service.currentActivity, act);

            $rootScope.$broadcast("ActivitiesService_currentActivityUpdated", 
                service.currentActivity);
        });
    };

    service.setCurrentActivity = (activity) => {
        Object.assign(service.currentActivity, activity);

        $rootScope.$broadcast("ActivitiesService_currentActivityUpdated", 
            service.currentActivity);
    };

    service.setActivities =  (activities) => {
        service.activities = activities;
        $rootScope.$broadcast("ActivitiesService_activitiesUpdated", service.activities);
    };

    service.loadActivities = () => {
        return $http({
            url:    "get-activities",
            method: "post",
            data:   {}
        }).then((data) => {
            data.activities.map(activity => {
                activity.title = activity.design.metainfo.title;
            });
            service.setActivities(data.activities);
        }).catch((error) => {
            console.log("[ActivitiesService.loadActivities] Error loading activities.");
            throw error;
        });
    }; 

    service.lookUpActivity = (id, reload = true) => {
        const lookup = () => {
            const activity = service.activities.filter(activity => activity.id == id)[0] ?? null;
            if (!activity) {
                console.error(`[ActivitiesService.lookUpActivity] activity with id:'${id}'` + 
                    "not found.");
            }
            return activity;
        };
    
        if (reload) {
            return service.loadActivities()
                .then(lookup)
                .catch(error => {
                    console.error(
                        "[ActivitiesService.lookUpActivity] error loading activity for lookup" +
                            ` with id:'${id}': '${error}'.`);
                    throw error;
                });
        } else {
            return Promise.resolve(lookup());
        }
    };

    service.createActivity = (sessionId, designId, setAsCurrent = true) => {
        var postdata = { sesid: sessionId, dsgnid: designId};
        return $http({ url: "add-activity", method: "post", data: postdata })
            .then(result => {
                if (setAsCurrent) {
                    return service.setCurrentActivityById(result.id);
                }
            })
            .catch(error => {
                console.error("[Activities Service] Error creating activity in session id:" +
                    `'${sessionId}', with designId: '${designId}.'. Error: ${error}`);
            });
    };

    service.addPhaseToCurrentActivity = (phaseNumber, context) => {
        let apiObject = apiMod.getPhaseAPIObject(phaseNumber, context);
        return $http({url: "stages", method: "post", data: apiObject})
            .then((result) => {
                if (result.status == "err") {
                    throw new Error("Got error response from server");
                }
                else if (result.status != "ok") {
                    console.warn("[ActivitiesService.addPhaseToCurrentActivity] Got unknown " +
                        "response from server");
                }
                // Returns the id of the phase (stage) added
                return result.id;
            }).then(stageId => {
                return service.addContentToCurrentPhase(stageId, phaseNumber, context.design);
            })
            .catch(error => {
                console.error("ActivitiesService.addPhaseToCurrentActivity] An error occured: " +
                    `'${error}'`);
            });
    };

    service.addContentToCurrentPhase = (stageId, phaseNumber, design) => {

    };

    service.startPhaseInCurrentActivity = (phaseNumber, context) => {
        let postdata = {sesid: context.sessionId, stageid: phaseNumber};
        return $http({ url: "session-start-stage", method: "post", data: postdata })
            .then((result) => {
                if (result.status == "err") {
                    throw new Error("Got error response from server");
                }
                else if (result.status != "ok") {
                    console.warn("[ActivitiesService.addPhaseToCurrentActivity] Got unknown " +
                        "response from server");
                }
                service.currentActivity.currentPhase = phaseNumber;
                return service.currentActivity.currentPhase;
            });
    };

    service.getOngoingActivities = () => {
        return service.activities.filter((activity) => {
            return activity.status != 3 && activity.archived == false;
        });
    };

    service.getFinishedActivities = () => {
        return service.activities.filter((activity) => {
            return activity.status == 3 && activity.archived == false;
        });    
    };

    service.getArchivedActivities = () => {
        return service.activities.filter((activity) => {
            return activity.archived;
        });
    };

    service.init();
    
    return service;
};