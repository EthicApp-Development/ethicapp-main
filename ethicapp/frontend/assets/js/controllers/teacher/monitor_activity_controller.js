/*eslint func-style: ["error", "expression"]*/
export let MonitorActivityController = ($scope, $filter, $http, $window, Notification, $uibModal,
    ActivityStateService) => {
    var self = $scope;
    self.stagesState = null;
    self.completion = null;

    self.init = function() {
        if (self.selectedView === "activity") {
            self.currentStage();
        }
    };

    self.ActivityState = async function (stageId) {
        const postdata = { sesid: self.selectedSes.id };
    
        try {
            if (self.design.type === "semantic_differential") {
                const response = await $http({
                    url: "stage-state-df",
                    method: "post",
                    data: postdata
                });
                self.stagesState = response.data;
                self.ActivityCompletion(stageId);
    
            } else if (self.design.type === "ranking") {
                const response = await $http({
                    url: "stage-state-r",
                    method: "post",
                    data: postdata
                });
                self.stagesState = response.data;
                self.ActivityCompletion(stageId);
            }
        } catch (error) {
            console.error("Error fetching activity state:", error);
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

    self.nextActivityDesign = async function () {
        try {
            const stageCounter = self.currentActivity.stage + 1;
            const sesid = self.selectedSes.id;
            const current_phase = self.design.phases[stageCounter];
            
            const postdata = {
                number: stageCounter + 1,
                question: current_phase.q_text !== undefined ? current_phase.q_text : "",
                grouping: current_phase.mode === "team"
                    ? `${current_phase.stdntAmount}:${current_phase.grouping_algorithm}`
                    : null,
                type: current_phase.mode,
                anon: current_phase.anonymous,
                chat: current_phase.chat,
                sesid: sesid,
                prev_ans: self.getPrevAns(current_phase)
            };
            
            console.debug(postdata);

            // Step 1: Generate groups if needed
            if (current_phase.mode === "team") {
                await self.generateGroups(null, self.currentActivity.stage + 1);
            }

            // Step 2: Add stage
            const addStageResponse = await $http({
                url: "add-stage",
                method: "post",
                data: postdata
            });
            
            const stageid = addStageResponse.data.id;

            if (stageid != null) {
                // Step 3: Accept groups if type is "team"
                if (postdata.type === "team") {
                    await self.acceptGroups(stageid);
                }

                // Step 4: Handle different design types
                if (self.design.type === "semantic_differential") {
                    // Add differential questions sequentially
                    for (const [index, question] of current_phase.questions.entries()) {
                        const content = question.ans_format;
                        const differentialData = {
                            name: question.q_text,
                            tleft: content.l_pole,
                            tright: content.r_pole,
                            num: content.values,
                            orden: index + 1,
                            justify: content.just_required,
                            stageid: stageid,
                            sesid: sesid,
                            word_count: content.min_just_length
                        };
                        await $http({
                            url: "add-differential-stage",
                            method: "post",
                            data: differentialData
                        });
                    }

                    // Start session stage
                    const sessionStartData = { sesid: sesid, stageid: stageid };
                    await $http({
                        url: "session-start-stage",
                        method: "post",
                        data: sessionStartData
                    });

                    Notification.success("Fase creada correctamente");
                    self.currentStage();
                    self.shared.verifyTabs();
                    self.getStages();
                    self.selectedSes.current_stage = stageid;
                } else if (self.design.type === "ranking") {
                    // Add ranking roles sequentially
                    for (const role of current_phase.roles) {
                        const roleData = {
                            name: role.name,
                            jorder: role.type === "order",
                            justified: role.type != null,
                            word_count: role.wc,
                            stageid: stageid
                        };
                        await $http({
                            url: "add-actor",
                            method: "post",
                            data: roleData
                        });
                    }

                    // Start session stage
                    const sessionStartData = { sesid: sesid, stageid: stageid };
                    await $http({
                        url: "session-start-stage",
                        method: "post",
                        data: sessionStartData
                    });

                    Notification.success("Fase creada correctamente");
                    self.shared.verifyTabs();
                    self.currentStage();
                    self.selectedSes.current_stage = stageid;
                }
            } else {
                Notification.error("Error al crear la fase");
            }
        } catch (error) {
            console.error("Error in nextActivityDesign:", error);
            Notification.error("An error occurred while progressing to the next activity design");
        }
    };

    self.currentStage = function() {
        var pd = {
            sesid: self.selectedSes.id
        };
        return $http({ url: "get-current-stage", method: "post", data: pd }).then(function(response) {
            self.currentActivity.stage = response.data.length === 0 ? 0: response.data[0].number -1;
        });
    };

    self.openFinishConfirmationModal = function () {
        const modalInstance = $uibModal.open({
            templateUrl: "static/end-activity-dialog.html",
            controller: "ConfirmModalController",
            controllerAs: "vm"
        });
    
        modalInstance.result.then(async function () {
            try {
                await $http.post("session-finish-stages", { sesid: self.selectedSes.id });
                window.location.reload();
            } catch (error) {
                console.error("Error finishing session stages:", error);
                Notification.error("Error al finalizar la actividad");
            }
        }, function () {
            // Optional: handle the case when the modal is dismissed
        });
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