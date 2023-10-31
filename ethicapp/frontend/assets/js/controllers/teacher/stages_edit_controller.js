/*eslint func-style: ["error", "expression"]*/
import { getBlankSDDesign } from "../../libs/designs/semantic_differential.js";
import { getBlankRankingDesign } from "../../libs/designs/ranking.js";

export let StagesEditController = ($scope, DesignsService,
    ActivitiesService, 
    $filter, $http, Notification, $timeout) => {
    //console.log("StagesEditController Initializated");
    var self = $scope;

    self.keyGroups = function (k1, k2) {
        return {
            key:  k1 + (k2 == null ? "" : " " + k2),
            name: k1 + (k2 == null ? "" : " " + k2)
            //name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2)) FIX TRANSLATION BUG
        };
    };

    self.currentStage = 0; //index of stage
    self.currentQuestion = 0; //index of current question

    self.methods = [
        self.keyGroups("random"), self.keyGroups("performance", "homog"),
        self.keyGroups("performance", "heterg"), 
        self.keyGroups("knowledgeType", "homog"), self.keyGroups("knowledgeType", "heterg"), 
        self.keyGroups("previous")
    ];

    self.groupType = [self.keyGroups("individual"), self.keyGroups("team")];
    self.busy = false; //upload file
    self.extraOpts = false;
    self.documents = null;
    self.prevStages = false;
    self.error = false;
    self.saved = false;
    self.errorList = [];
    self.selectedOption = "";
    self.roles = [];

    self.init = function(){
        //resetValues();
        if(self.selectedView == "newDesign") {
            DesignsService.workingDesign = null;
        }
        if(DesignsService.workingDesign != null){
            self.stageType = DesignsService.workingDesign.type;
            if(self.stageType == "semantic_differential") {
                self.num = DesignsService.workingDesign
                    .phases[0].questions[0].ans_format.values;
            }
            resetValues();
            self.cleanEmptyValues();
            self.createErrorList();
        }
    };

    self.cleanEmptyValues = function(){
        let phases = DesignsService.workingDesign.phases;

        phases.map(phase => {
            if(self.stageType == "semantic_differential"){
                phase.questions.map(question => {
                    question.q_text = question.q_text === "-->>N/A<<--" ? "" : question.q_text;
                    question.ans_format.l_pole = question.ans_format.l_pole === "-->>N/A<<--" ? 
                        "" : question.ans_format.l_pole;
                    question.ans_format.r_pole = question.ans_format.r_pole === "-->>N/A<<--" ? 
                        "" : question.ans_format.r_pole;
                });
            }
            else if(self.stageType == "ranking"){
                phase.q_text = phase.q_text === "-->>N/A<<--" ? "" : phase.q_text;
                phase.roles.map(role => {
                    role.name = role.name === "-->>N/A<<--" ? "" : role.name;
                });
            }
        });
    };

    self.createErrorList = function(){
        //[[{q:false, l:false, t:true}]]
        var phases = DesignsService.workingDesign.phases;
        for(let i = 0; i< phases.length; i++){
            var phase = phases[i];
            if(self.stageType == "semantic_differential"){
                var questions = phase.questions;
                let questionsErrorList = [];
                for(let j=0; j<questions.length; j++){
                    let questionErrors = {};
                    var question = questions[j];

                    questionErrors = {
                        q: question.q_text == "",
                        l: question.ans_format.l_pole == "",
                        r: question.ans_format.r_pole ==""
                    };
    
                    questionsErrorList.push(questionErrors);
                }
                self.errorList.push(questionsErrorList);
            }
            else if(self.stageType == "ranking"){
                var roles = phase.roles;
                var rolesErrorList = [];
                for(let j=0; j<roles.length; j++){
                    var role = roles[j];

                    rolesErrorList.push(role.name=="");
                }
                self.errorList.push(rolesErrorList);
            }
        }
    };

    self.checkPhase = function(phase) { // IF Phase deleted or Question deleted, delete errorList
        if(self.stageType == "semantic_differential") {
            const questions = self.errorList[phase];
            let error = false;
            for(let question = 0; question < questions.length; question++){
                const questionValues = Object.values(self.errorList[phase][question]);
                const questionResult = checkIfTrue(questionValues);
                if(questionResult) error = true;
            }
            return error;
        }
        else if(self.stageType == "ranking") {
            const roles = self.errorList[phase];
            let error = false;
            if(DesignsService.workingDesign.phases[phase].q_text == "") {
                error = true;
            }
            for(let role = 0; role < roles.length; role++){
                if(self.errorList[phase][role]) error = true;
            }
            return error;
        }
    };

    self.checkQuestion = function(index){
        if(self.currentStage !== null) {
            const phase = self.currentStage;
            const questionValues = Object.values(self.errorList[phase][index]);
            return checkIfTrue(questionValues);
        }
    };

    let checkIfTrue = (arr) => {
        return arr.some(value => value === true);
    };
    
    self.isEmpty = function(value, type){
        //check currentStage && currentQuestion to update on the fly
        if(self.stageType == "semantic_differential" && 
            self.currentStage !== null || type == ""){
            const _isEmpty = value === "";
            const phase = self.currentStage;
            const question  = self.currentQuestion;
            if(type !== "") {
                self.errorList[phase][question][type] = _isEmpty;
            }
            return _isEmpty;
        }
    };

    self.isTextEmpty = function(index, value){
        if(self.stageType == "ranking" && self.currentStage !== null){
            //check currentStage && currentQuestion to update on the fly
            const _isEmpty = value==="";
            const phase = self.currentStage;
            self.errorList[phase][index] = _isEmpty;
            return _isEmpty;
        }
    };

    self.launchDesignFromEditor = function(){
        self.updateDesign().then(function(saved) {
            if(saved) {
                ActivitiesService.currentActivityState.id = DesignsService
                    .workingDesign.id;
                ActivitiesService.currentActivityState.title = DesignsService
                    .workingDesign
                    .metainfo.title;
                ActivitiesService.currentActivityState.type = DesignsService
                    .workingDesign
                    .type;
                self.selectView("launchActivity");
            }
        });
    };
  
    self.uploadBlankDesign = function (title, author, type) {
        let designs = {
            "semantic_differential": getBlankSDDesign,
            "ranking":               getBlankRankingDesign
        };
        
        if (!(type in designs)) {
            throw Error("[StagesEditController] Design type not found");
        }
        
        let postdata = designs[type]();

        return $http.post("upload-design", postdata)
            .then(function (data) {
                if (data.status == "ok") {
                    DesignsService.loadUserDesignById(data.id);
                }
                else {
                    throw new Error("Could not start ");
                }
            }).catch(error => {
                console.log(`[StagesEditController] Failed to upload blank design: ${error}`);
            });
    };

    self.addRole = function(){
        DesignsService.workingDesign.phases[self.currentStage].roles.push({
            name: "",
            type: "role", //order
            wc:   5
        });
    };

    self.setRoleType = function(role, type){
        if(role.type == type){
            role.type = null;
            return;
        }
        if(self.roles.find(e => e.type != null && e.type != type)){
            self.setAllRolesType(null);
        }

        role.type = type;
    };

    self.setAllRolesType = function (type) {
        for (let i = 0; i < DesignsService.workingDesign
            .phases[self.currentStage]
            .roles
            .length; i++) {
            DesignsService
                .workingDesign
                .phases[self.currentStage]
                .roles[i].type = type;
        }
    };

    self.removeRole = function (index) {
        if (window.confirm("¿Esta seguro de eliminar este rol?")) {
            DesignsService.workingDesign
                .phases[self.currentStage].roles.splice(index, 1);
        }
    };

    self.updateDesign = function() {
        self.error = self.checkDesign();
        self.saved = false;

        if (self.error) {
            throw new ("[StagesEditController] Failed to update design");
        }

        // Avoid saving the design object containing id field
        let { id, ...designNoId } = DesignsService.workingDesign;

        var postdata = { 
            "design": designNoId, 
            "id":     id
        };
        
        return $http.post("update-design", postdata)
            .then((response) => {
                if (response.data.status == "ok") {
                    self.saved = true;
                } else {
                    self.saved = false;
                    throw new Error("[StagesEditController] Failed to update design");
                }
                return Promise.resolve(self.saved);
            });
    };

    self.checkDesign = () => { 
        let error = false;
        let phases = DesignsService.workingDesign.phases;

        phases.map((phase) => {
            if (DesignsService.workingDesign.metainfo.title === "") {
                error = true;
            }

            if (phase.mode == "individual") {
                phase.chat = false;
                phase.anonymous = false;
            }

            if (self.stageType == "semantic_differential"){
                let questions = phase.questions;

                questions.map((question) => {
                    error = question.q_text == "";
                    error = question.ans_format.l_pole == "";
                    error = question.ans_format.r_pole == "";
                    error = question.ans_format.min_just_length < 0;
                });
            }

            if(self.stageType == "ranking"){
                let roles = phase.roles;
                error = phase.q_text == "";

                roles.map((role) => {
                    error = role.name == "";
                });
            }
        });

        return error;
    };

    self.getDesignId = function(){
        return DesignsService.workingDesign.id;
    };

    self.getDesign = () => {
        return DesignsService.workingDesign;
    };

    let resetValues = () => {
        self.design = DesignsService.workingDesign;
        self.currentStage = 0; 
        self.currentQuestion = 0; 
        self.stageType = DesignsService.workingDesign.type;
        self.busy = false; 
        self.extraOpts = false;
        self.prevStages = false;
    };

    /*
        FRONTEND FUNCTIONS
    */

    self.toggleOpts = function(opt){
        if (opt == 1) {
            self.extraOpts = !self.extraOpts;
        }
        else if (opt == 2) {
            self.prevStages = !self.prevStages;
        }
    };

    self.buildArray = function (n) {
        var a = [];
        for (var i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };
    
    self.selectQuestion = function(id){
        self.currentQuestion = id; 
        self.num = DesignsService.workingDesign
            .phases[self.currentStage]
            .questions[self.currentQuestion].ans_format
            .values;
    };

    self.addQuestion = function(){
        DesignsService.workingDesign
            .phases[self.currentStage].questions.push(
                {
                    "q_text":     "",
                    "ans_format": {
                        "values":          5,
                        "l_pole":          "",
                        "r_pole":          "",
                        "just_required":   true,
                        "min_just_length": 10
                    }});
        self.selectQuestion(DesignsService.workingDesign
            .phases[self.currentStage]
            .questions
            .length-1); //send to new question
        self.errorList[self.currentStage].push({q: true,l: true,r: true});
    };

    self.deleteQuestion = function(index){
        // Requires that the current question is set and there is more than one question available
        if (self.currentQuestion != null &&
            DesignsService.workingDesign
                .phases[self.currentStage].questions.length != 1)
        {
            //change question index
            if(index == 0) {
                self.currentQuestion = 0;
            }
            else { 
                self.currentQuestion = self.currentQuestion -1;
            }
            DesignsService.workingDesign
                .phases[self.currentStage].questions.splice(index, 1);
            self.errorList[self.currentStage].splice(index, 1);
            self.selectQuestion(self.currentQuestion);
        }
    };

    self.selectStage = function(id){
        if(self.currentStage != id){
            self.currentStage = id;
            self.stageType = DesignsService.workingDesign.type;
            self.currentQuestion = 0; //reset question index
            if(self.stageType == "semantic_differential"){  
                self.num = DesignsService.workingDesign.phases[self.currentStage]
                    .questions[self.currentQuestion]
                    .ans_format.values;
            }
        }
        else {
            /*
            self.currentStage = null; //unselect current stage
            self.num = null;
            self.stageType  = null;
            */
        }
        self.extraOpts = false;
        self.prevStages = false;
        //console.log(self.methods);
    };

    self.deleteStage = function(){
        if(self.currentStage != null && DesignsService.workingDesign
            .design.phases.length != 1) {
            var index = self.currentStage;
            DesignsService.workingDesign.phases.splice(index, 1);
            self.currentQuestion = 0; //reset question index
            self.num = null;
            self.currentStage = null;
            self.extraOpts = false;
            self.prevStages = false;
            self.errorList.splice(index, 1);
        }
    };
    
    self.copyPrevStage = function(type, prevphase){
        var phase = JSON.parse(JSON.stringify(prevphase)); //removes reference from previous object
        if(type =="semantic_differential"){
            return {
                "mode":               phase.mode,
                "chat":               phase.chat,
                "anonymous":          phase.anonymous,
                "questions":          phase.questions,
                "grouping_algorithm": phase.grouping_algorithm,
                "prevPhasesResponse": [],//phase.prevPhasesResponse,
                "stdntAmount":        phase.stdntAmount
            };
        }
        else if (type == "ranking") {
            return{
                mode:               phase.mode,
                chat:               phase.chat,
                anonymous:          phase.anonymous,
                grouping_algorithm: phase.grouping_algorithm,
                prevPhasesResponse: [],
                stdntAmount:        phase.stdntAmount,
                q_text:             phase.q_text,
                roles:              phase.roles
            };
        }
    };

    self.addStage = function(){
        var index = DesignsService.workingDesign.phases.length - 1;
        var prev_phase = DesignsService.workingDesign.phases[index];
        DesignsService.workingDesign
            .phases.push(self.copyPrevStage(self.stageType, prev_phase));
        self.errorList.push(JSON.parse(JSON.stringify(self.errorList[index])));
    };

    self.getStages = function(){
        return DesignsService.workingDesign.phases;
    };

    self.amountOptions = function(type){
        self.num = DesignsService.workingDesign
            .phases[self.currentStage]
            .questions[self.currentQuestion]
            .ans_format
            .values;
        if(type == "+"){
            self.num = self.num < 9 ? self.num + 1 : 10;
        }
        else{
            self.num = self.num > 2 ? self.num - 1 : 2;
        }
        DesignsService.workingDesign.phases[self.currentStage]
            .questions[self.currentQuestion]
            .ans_format
            .values = self.num;
    };

    self.init(); //init
};
