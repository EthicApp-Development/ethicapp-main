/*eslint func-style: ["error", "expression"]*/
export let MonitorActivityController = ($scope, $filter, $http, $window, Notification) => {
    var self = $scope;
    self.stagesState = null;
    self.completion = null;

    self.init = function() {
        if (self.selectedView === "activity") {
            self.currentStage();
        }
    };

    self.ActivityState = function(stageId){
        if(self.design.type == "semantic_differential"){
            $http({
                url: "stage-state-df", method: "post", data: {sesid: self.selectedSes.id}
            }).success(function (data) {
                self.stagesState = data;
                self.ActivityCompletion(stageId);
            });
        }
        else if (self.design.type == "ranking") {
            $http({
                url: "stage-state-r", method: "post", data: {sesid: self.selectedSes.id}
            }).success(function (data) {
                self.stagesState = data;
                self.ActivityCompletion(stageId);
            });
        }
    };

    self.test = function(xd, xd2){
        console.log(xd2[0]);
        console.log(xd2);
    };

    self.ActivityCompletion = function(stageId){
        const numUsers = Object.keys(self.users).length -1;
        
        const stageCounter = self.stagesState.findIndex(stage => stage.id === stageId);
        var current_phase = self.design.phases[stageCounter];
        if(self.stagesState[stageCounter] !== undefined){
            var current_phase = self.design.phases[stageCounter];
            if(self.design.type == "semantic_differential"){
                self.completion = self.stagesState[stageCounter].count +"/" +  numUsers;
            }
            else if(self.design.type == "ranking"){
                self.completion =  self.stagesState[stageCounter].count/self.stagesState[stageCounter].count +"/" + numUsers;
            }
        }
        else{
            var current_phase = self.design.phases[self.currentActivity.stage];
            if(self.design.type == "semantic_differential"){
                self.completion = 0+"/" +  numUsers;
            } 
            else if(self.design.type == "ranking"){
                self.completion = 0+"/" + numUsers;
            }
        }
    };

    self.getPrevAns = function(current_phase){
        if(current_phase.prevPhasesResponse.length == 0){ //! Unreachable code volver prev_ans = [] al copiar fase anterior
            return "";
        }
        var temp = [];
        let answers = current_phase.prevPhasesResponse;
        for(let i=0; i < current_phase.prevPhasesResponse.length; i++){
            let answerIndex = answers[i];
            temp.push(self.stages[answerIndex]);
        }
        return temp.map(e => e.id).join(",");
    };

    self.nextActivityDesign = function () {//check for race condition
        var stageCounter = self.currentActivity.stage + 1;
        var sesid = self.selectedSes.id;
        var current_phase = self.design.phases[stageCounter];
        var postdata = {
            number:   stageCounter + 1,
            question: current_phase.q_text !== undefined ? current_phase.q_text : "",
            grouping: current_phase.mode == "team" ?
                current_phase.stdntAmount + ":" + current_phase.grouping_algorithm :
                null,
            type:     current_phase.mode,
            anon:     current_phase.anonymous,
            chat:     current_phase.chat,
            sesid:    sesid,
            prev_ans: self.getPrevAns(current_phase)
        };
        console.debug(postdata);
        if(current_phase.mode == "team"){
            self.generateGroups(null,self.currentActivity.stage +1 ); //<-------------update value
        }
        
        $http({url: "add-stage", method: "post", data: postdata}).success(function (data) {
            let stageid = data.id;
            if (stageid != null) {
      
                if (postdata.type == "team") {
                    self.acceptGroups(stageid);
                }

                //console.log("TYPE:",self.selectedSes.type);
                if (self.design.type == "semantic_differential") {
                    var counter = 1;
                    for(var question of current_phase.questions){
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
                        //console.log(p);
                        $http({
                            url: "add-differential-stage", method: "post", data: p
                        }).success(function () {    });
                        counter++;
                    }
                    let pp = {sesid: sesid, stageid: stageid};
                    $http({
                        url: "session-start-stage", method: "post", data: pp
                    }).success(function (data) {
                        Notification.success("Etapa creada correctamente");
                        //window.location.reload()
                        self.currentStage(); // <--------Actualiza la data del current stage
                        self.shared.verifyTabs();
                        self.getStages();
                        self.selectedSes.current_stage = stageid;
                        //call request to change activity currentstage 
                    });
                }
                else if (self.design.type == "ranking") {
                    let c = current_phase.roles.length;
                    for (let i = 0; i < current_phase.roles.length; i++) {
                        const role = current_phase.roles[i];
                        let p = {
                            name:       role.name,
                            jorder:     role.type == "order",
                            justified:  role.type != null,
                            word_count: role.wc,
                            stageid:    stageid,
                        };
                        $http({url: "add-actor", method: "post", data: p}).success(function (data) {
                            //console.log("Actor added");
                            c -= 1;
                            if (c == 0) {
                                let pp = {sesid: sesid, stageid: stageid};
                                $http({
                                    url: "session-start-stage", method: "post", data: pp
                                }).success(function (data) {
                                    Notification.success("Etapa creada correctamente");
                                    //window.location.reload()
                                    self.shared.verifyTabs();
                                    self.currentStage();
                                    self.selectedSes.current_stage = stageid;
                                    //call request to change activity currentstage 
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
   
    };

    self.currentStage = function() {
        var pd = {
            sesid: self.selectedSes.id
        };
        return $http({ url: "get-current-stage", method: "post", data: pd }).then(function(response) {
            self.currentActivity.stage = response.data.length === 0 ? 0: response.data[0].number -1;
        });
    };
    
    self.finishActivity = function(){
        var confirmationMessage;

        if (self.lang === 'EN_US/english') {
            confirmationMessage = 'Are you sure you want to finish the activity?';
        } else {
            confirmationMessage = '¿Estás seguro que quieres terminar la actividad?';
        }
        if ($window.confirm(confirmationMessage)) {
        $http.post("session-finish-stages", { sesid: self.selectedSes.id }).success((data) => {
            window.location.reload();
        });
        } else {
        }
    };

    self.copyToClipboard = function() {
        var codeElement = document.querySelector('.code-div strong');
        var codeToCopy = codeElement.textContent;

        var tempInput = document.createElement('textarea');
        tempInput.value = codeToCopy;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);

        var codeMessage;

        if (self.lang === 'EN_US/english') {
            codeMessage = 'Session code copied';
        } else {
            codeMessage = 'Código de sesión copiado';
        }
        
        Notification.success(codeMessage);

    };

    self.init();
};