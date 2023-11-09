import * as apiMod from "./activities_service/factories/api_object_factory.js";
import * as cp from "./activities_service/plugins/content_plugin_registry.js";

export let ActivitiesService = ($rootScope, $http) => {
    let service = { };
    service.activities = [];
    let contentPlugin = null;

    service.init = () => {
        service.loadActivities();
        service.clearCurrentActivity();
    };

    service.clearCurrentActivity = () => {
        service.currentActivity = {
            designId: null,
            title:    null,
            type:     null,
        };
    };
    
    service.setCurrentActivityById = (activityId) => {
        // Assign fields to activity object
        service.lookUpActivity(activityId).then(activity => {
            service.setCurrentActivity(activity);
        });
    };

    service.setCurrentActivity = (activity) => {
        // Strip current activity object
        Object.keys(service.currentActivity).forEach(
            key => delete service.currentActivity[key]);

        // Copy the fields
        Object.assign(service.currentActivity, activity);

        service.currentActivity = activity;
        // Set the current content plugin
        service.setContentPlugin(activity.design.metainfo.type);

        $rootScope.$broadcast("ActivitiesService_currentActivityUpdated", 
            service.currentActivity);
    };

    service.setContentPlugin = (designType) => {
        if (!(designType in cp.contentPluginRegistry)) {
            let err = `No content plugin found for design type '${designType}'`;
            console.error(`[ActivitiesService.setContentPlugin] ${err}`);
            throw new Error(err);
        }

        service.contentPlugin = cp.contentPluginRegistry[designType];
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

    service.addPhaseToCurrentActivity = (params) => {
        let apiObject = apiMod.getPhaseAPIObject(params);
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
                return service.addContentToCurrentPhase(
                    params.sessionId, stageId, params.phase)
                    .then(() => {
                        return stageId;
                    });
            })
            .catch(error => {
                console.error("ActivitiesService.addPhaseToCurrentActivity] An error occured: " +
                    `'${error}'`);
            });
    };

    service.addContentToCurrentPhase = (sessionId, stageId, phaseDesign) => {
        if (phaseDesign == undefined) {
            throw new Error("[ActivitiesService.addContentToCurrentPhase] invalid phase design");
        }

        if (contentPlugin == undefined) {
            throw new Error("[ActivitiesService.addContentToCurrentPhase] content plugin not set!");
        }

        contentPlugin.addContentToPhase($http, sessionId, stageId, phaseDesign)
            .catch(error => {
                let err = `Failed to add content to stage id:'${stageId}'`;
                console.error(`[ActivitiesService.addContentToCurrentPhase] Error: '${err}'`);
                throw error;
            });
    };

    service.startPhaseInCurrentActivity = (params) => {
        let postdata = {sesid: params.sessionId, stageid: params.stageId};
        return $http({ url: "session-start-stage", method: "post", data: postdata })
            .then((result) => {
                if (result.status == "err") {
                    throw new Error("Got error response from server");
                }
                else if (result.status != "ok") {
                    console.warn("[ActivitiesService.addPhaseToCurrentActivity] Got unknown " +
                        "response from server");
                }
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