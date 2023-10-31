export let ActivitiesService = ($http) => {
    var service = { };
    service.activities = [];

    service.clearCurrentActivity = () => {
        service.currentActivity = {
            designId:     null,
            title:        null,
            type:         null,
            currentPhase: -1
        };
    };
    service.clearCurrentActivity();

    service.setCurrentActivityById = (activityId) => {
        let act = service.lookUpActivity(activityId);
        Object.assign(service.currentActivity, act);
    };

    service.setCurrentActivity = (activity) => {
        Object.assign(service.currentActivity, activity);
    };

    service.loadActivities = () => {
        return $http({
            url:    "get-activities",
            method: "post",
            data:   {}
        }).then((data) => {
            for (var index = 0; index < data.activities.length; index++) {
                data.activities[index].title = data.activities[index].design.metainfo.title;
            }
            service.activities = data.activities;
        }).catch((error) => {
            console.log("[Activities Service] Error loading activities.");
            throw error;
        });
    }; 

    service.lookUpActivity = (id, reload = true) => {
        const lookup = () => {
            const activity = service.activities.filter(activity => activity.id == id)[0] ?? null;
            if (!activity) {
                console.error(`[Activities Service] activity with id:'${id}' not found.`);
            }
            return activity;
        };
    
        if (reload) {
            return service.loadActivities()
                .then(lookup)
                .catch(error => {
                    console.error(
                        `[Activities Service] error loading activity for lookup with id:'${id}': '${error}'.`);
                    throw error;
                });
        } else {
            return Promise.resolve(lookup());
        }
    };

    service.createActivity = function(sessionId, designId){
        var postdata = { sesid: sessionId, dsgnid: designId};
        return $http({ url: "add-activity", method: "post", data: postdata })
            .catch(error => {
                console.log(`[Activities Service] Error creating activity in session id:'${sessionId}', with designId: '${designId}.'`);
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
    
    return service;
};