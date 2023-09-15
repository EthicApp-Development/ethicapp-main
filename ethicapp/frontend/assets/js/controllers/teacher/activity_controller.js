/*eslint func-style: ["error", "expression"]*/
export let ActivityController = ($scope, ActivityStateService, $filter, $http, Notification, $timeout) => {
    var self = $scope;
    self.selectedSes = {};
    self.error = false;
    self.showSpinner = false;
    self.launchId = ActivityStateService.activityState;
    
    self.init =function(){
        self.selectedSes = {};
        self.launchDesignId = launchId.id;
    };

    //Create Activity from launch activity
    self.createSession = function(dsgnName, dsgndescr, dsgntype, dsgnid){

        self.showSpinner = true;

        $http({
            url: "check-design", method: "post", data: { dsgnid: dsgnid}
        }).success(function (data) {
            self.error = !data.result;
            console.log(self.error);
            if(data.result){
                var postdata = { name: dsgnName, descr: dsgndescr, type: dsgntype};
                $http({
                    url: "add-session-activity", method: "post", data: postdata
                }).success(function (data) {
                    console.log("SESSION CREATED");
                    var id = data.id;
                    self.createActivity(id, dsgnid,);
                    self.generateCodeActivity(id);
                    self.shared.getActivities();
                    self.shared.updateSesData();
                    $timeout(function() {
                        self.showSpinner = false; 
                    }, 5000);
                    //console.log(data);
                });
            }
        });
    };

    self.createActivity = function(sesID, dsgnID){
        var postdata = { sesid: sesID, dsgnid: dsgnID};
        $http({ url: "add-activity", method: "post", data: postdata }).success(function (data) {
            console.log("ACTIVITY CREATED");
            var dsng = data.result;
            self.startActivityDesign(dsng, sesID);
            let result = self.shared.getActivities();
            result.then(
                function(result) {
                    const filteredObj = result.filter(item => item.session === sesID)[0];
                    console.log(filteredObj);
                    self.selectActivity(filteredObj.id, sesID, dsng);
                },
                function(error) {
                    // This code runs when the Promise is rejected
                    console.log(error);
                }
            );
            //get current DESIGNS UPDATED
            //console.log(data);
        });
    };

    self.startActivityDesign = function (design, sesid) {
        //change it to do it for the first stage or a selected stage?
        var stageCounter = 0;
        console.log(design);
        for(var phase of design.phases){
            console.log(phase);
            var postdata = {
                number:   stageCounter + 1,
                question: phase.q_text !== undefined ? phase.q_text : "",

                // ver si es equipo, si lo es, igualar a numero de integrantes + el tipo,
                // sino es nulo
                grouping: phase.mode == "team" ?
                    phase.stdntAmount + ":" + phase.grouping_algorithm :
                    null,
                type:     phase.mode,
                anon:     phase.anonymous,
                chat:     phase.chat,
                sesid:    sesid,
                prev_ans: ""
            };
            console.log(postdata);

            $http({url: "add-stage", method: "post", data: postdata}).success(function (data) {
                let stageid = data.id;
                if (stageid != null) {
                /*
                if (postdata.type == "team") {
                    self.acceptGroups(stageid);
                }
                */
                    console.log(self.selectedSes);
                    console.log("TYPE:",self.selectedSes.type);
                    if (design.type == "semantic_differential") {
                        var counter = 1;
                        for(var question of phase.questions){
                            var content = question.ans_format;
                            let p = {
                                name:       question.q_text,
                                tleft:      content.l_pole,
                                tright:     content.r_pole,
                                num:        content.values,
                                orden:      counter,
                                justify:    content.just_required,
                                stageid:    stageid,
                                sesid:      sesid,
                                word_count: content.min_just_length
                            };
                            console.log(p);
                            $http({url:
                                "add-differential-stage", method: "post", data:   p
                            }).success(function () {
                                let pp = {sesid: sesid, stageid: stageid};
                                $http({
                                    url: "session-start-stage", method: "post", data: pp
                                }).success(function () {
                                    Notification.success("Etapa creada correctamente");
                                });
                            
                            });
                            counter++;
                        }
                    }
                    else if (design.type == "ranking") {
                        let c = phase.roles.length;
                        for (let i = 0; i < phase.roles.length; i++) {
                            const role = phase.roles[i];
                            let p = {
                                name:       role.name,
                                jorder:     role.type == "order",
                                justified:  role.type != null,
                                word_count: role.wc,
                                stageid:    stageid,
                            };
                            $http({url: "add-actor", method: "post", data: p}).success((data) => {
                                console.log("Actor added");
                                c -= 1;
                                if (c == 0) {
                                    let pp = {sesid: sesid, stageid: stageid};
                                    $http({
                                        url: "session-start-stage", method: "post", data: pp
                                    }).success(function (data) {
                                        Notification.success("Etapa creada correctamente");
                                    });
                                }
                            });
                        }
                    }

                
                }
                else {
                    Notification.error("Error al crear la etapa");
                }
            });
    
            stageCounter++;
            break;
        }
    };

    self.generateCodeActivity = function (ID) { //use it to generate the code
        var postdata = {
            id: ID
        };
        $http.post("generate-session-code", postdata).success(function (data) {
            if (data.code != null) self.selectedSes.code = data.code;
        });
    };

    self.currentActivities = function(type){
        if (type == 0) return self.activities.filter(function(activity) {
            return activity.status != 3 && activity.archived == false;
        });
        if (type == 1) return self.activities.filter(function(activity) {
            return activity.status == 3 && activity.archived == false;
        });
        if (type == 2) return self.activities.filter(function(activity) {
            return activity.archived;
        });
    };

    self.designSelected = function(){
        return launchId.id;
    };

    self.createCopy = function(ses){
        self.createSession(ses.name, ses.descr, ses.type, ses.dsgnid);
        self.shared.getActivities();
        self.shared.updateSesData();
        Notification.success("Actividad copiada!");
    };
    self.init();
};