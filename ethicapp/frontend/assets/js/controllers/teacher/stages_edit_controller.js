/*eslint func-style: ["error", "expression"]*/
export let StagesEditController = ($scope, DesignStateService,
    ActivityStateService, 
    $filter, $http, Notification, $timeout) => {
    var self = $scope;
    self.designId = DesignStateService.designstate;
    self.launchId = ActivityStateService.activityState;

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
        self.keyGroups("knowledgeType", "homog"), self.keyGroups("knowledgeType", "heterg")
        , self.keyGroups("previous")
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
    /*
        BACKEND FUNCTIONS
    */
    self.init = function(){
        //resetValues();
        if(self.selectedView == "newDesign") self.changeDesign(null);
        if(self.design != null){
            self.stageType = self.design.type;
            if(self.design.type == "semantic_differential") self.num = self.design.phases[0].questions[0].ans_format.values;
            resetValues();
            self.CleanEmptyValues();
            self.CreateErrorList();
        }
    };

    self.CleanEmptyValues = function(){
        var phases = self.design.phases;
        for(let i =0; i< phases.length; i++){
            var phase = phases[i];
            if(self.stageType == "semantic_differential"){
                var questions = phase.questions;
                for(let j=0; j<questions.length; j++){
                    var question = questions[j];

                    question.q_text = question.q_text === "-->>N/A<<--" ? "" : question.q_text;
                    question.ans_format.l_pole = question.ans_format.l_pole === "-->>N/A<<--" ? "" : question.ans_format.l_pole;
                    question.ans_format.r_pole = question.ans_format.r_pole === "-->>N/A<<--" ? "" : question.ans_format.r_pole;
                }
            }
            else if(self.stageType == "ranking"){
                var roles = phase.roles;
                phase.q_text = phase.q_text === "-->>N/A<<--" ? "" : phase.q_text;
                for(let j=0; j<roles.length; j++){
                    var role = roles[j];
                    role.name = role.name === "-->>N/A<<--" ? "" : role.name;
                }
            }
        }
    
        return;
    };

    self.CreateErrorList = function(){
        //[[{q:false, l:false, t:true}]]
        var phases = self.design.phases;
        for(let i =0; i< phases.length; i++){
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

    self.CheckPhase = function(phase){ //IF Phase deleted or Question deleted, delete errorList
        if(self.stageType == "semantic_differential"){
            const questions = self.errorList[phase];
            let error = false;
            for(let question=0; question<questions.length; question++){
                const questionValues = Object.values(self.errorList[phase][question]);
                const questionResult = checkIfTrue(questionValues);
                if(questionResult) error = true;
            }
            return error;
        }
        else if(self.stageType == "ranking"){
            const roles = self.errorList[phase];
            let error = false;
            if(self.design.phases[phase].q_text == "") error = true;
            for(let role=0; role<roles.length; role++){

                if(self.errorList[phase][role]) error = true;
            }
            return error;
        }
    };

    self.CheckQuestion = function(index){
        if(self.currentStage !== null){
            const phase = self.currentStage;
            const questionValues = Object.values(self.errorList[phase][index]);
            return checkIfTrue(questionValues);
        }
    };

    let checkIfTrue = (arr) => {
        return arr.some(value => value === true);
    };
    
    self.IsEmpty = function(value, type){
        //check currentStage && currentQuestion to update on the fly
        if(self.stageType == "semantic_differential" && self.currentStage !== null || type == ""){
            const isEmpty = value==="";
            const phase = self.currentStage;
            const question  = self.currentQuestion;
            if(type !== "") self.errorList[phase][question][type] = isEmpty;

            return isEmpty;
        }
        
    };

    self.IsTextEmpty = function(index, value){
        if(self.stageType == "ranking" && self.currentStage !== null){
            //check currentStage && currentQuestion to update on the fly
            const isEmpty = value==="";
            const phase = self.currentStage;
            self.errorList[phase][index] = isEmpty;
            return isEmpty;
        }
    };

    self.launchDesignEdit = function(){
        self.updateDesign().then(function(saved) {
            if(saved){
                self.launchId.id = self.designId.id;
                self.launchId.title = self.design.metainfo.title;
                self.launchId.type = self.design.type;
                self.selectView("launchActivity");
            }
        });
    };
  
    self.uploadDesign = function (title, author, type) {
        var semantic = { 
            "metainfo": {
                "title":         title,
                "author":        author,
                "creation_date": Date.now()
            },
            "roles":  [],
            "type":   "semantic_differential",
            "phases": [
                {
                    "mode":               "individual",
                    "chat":               false,
                    "anonymous":          true,
                    "grouping_algorithm": "random",
                    "prevPhasesResponse": [ ],
                    "stdntAmount":        3,
                    "questions":          [
                        {
                            "q_text":     "-->>N/A<<--",
                            "ans_format": {
                                "values":          7,
                                "l_pole":          "-->>N/A<<--",
                                "r_pole":          "-->>N/A<<--",
                                "just_required":   true,
                                "min_just_length": 5
                            }
                        }
                    ]
                }
            ]
        };
        var ranking = { 
            "metainfo": {
                "title":         title,
                "author":        author,
                "creation_date": Date.now()
            },
            "roles":  [],
            "type":   "ranking",
            "phases": [
                {
                    "mode":               "individual",
                    "chat":               false,
                    "anonymous":          true,
                    "grouping_algorithm": "random",
                    "prevPhasesResponse": [ ],
                    "stdntAmount":        3,
                    "q_text":             "-->>N/A<<--",
                    "roles":              [
                    ]
                }
            ]
        };
        if(type){
            var postdata;
            if(type === "semantic_differential"){
                postdata = semantic;
            }
            else if(type== "ranking"){
                postdata = ranking;
            }

            $http.post("upload-design", postdata).success(function (data) {
                if (data.status == "ok") {
                    self.getDesign(data.id);
                }
            });
        }
        
    };

    self.addRole = function(){
        self.design.phases[self.currentStage].roles.push({
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
        for (let i = 0; i < self.design.phases[self.currentStage].roles.length; i++) {
            self.design.phases[self.currentStage].roles[i].type = type;
        }
    };

    self.removeRole = function (index) {
        if (window.confirm("¿Esta seguro de eliminar este rol?")) {
            self.design.phases[self.currentStage].roles.splice(index, 1);
        }
    };

    self.updateDesign = function() {
        self.error = self.checkDesign();
        if (!self.error) {
            var postdata = {"design": self.design, "id": self.designId.id};
            $http.post("update-design", postdata).then(function(response) {
                if (response.data.status == "ok") {
                    self.saved = true;
                } else {
                    self.saved = false;
                }
            }, function() {
                self.saved = false;
            });
        } else {
            self.saved = false;
        }
        return $timeout(function() {
            return self.saved;
        }, 500);
    };
    

    self.checkDesign = function(){ 
        var error = false;
        var phases = self.design.phases;
        //console.log(self.design);
        for(let i =0; i< phases.length; i++){
            var phase = self.design.phases[i];


            if(self.design.metainfo.title === "") error = true;

            if(phase.mode == "individual"){
                phase.chat = false;
                phase.anonymous = false;
            }
            if(self.stageType == "semantic_differential"){
                var questions = phase.questions;
                for(let j=0; j<questions.length; j++){
                    var question = questions[j];
                    if(question.q_text == "") error = true;
                    if(question.ans_format.l_pole == "") error = true;
                    if(question.ans_format.r_pole =="") error = true;
                    if(question.ans_format.min_just_length < 0 ) error = true;
                }
            }
            if(self.stageType == "ranking"){
                var roles = phase.roles;
                if(phase.q_text == "") error = true;
                for(let j=0; j<roles.length; j++){
                    var role = roles[j];
                    if(role.name == "") error = true;
                }
            }

        }
        return error;
    };



    self.getDesign = function (ID) {
        $http.post("get-design", ID).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result);
                self.designId.id = ID; //use variable from admin later
                self.selectView("newDesignExt");
            }
        });
    };


    self.getID = function(){
        return self.designId.id;
    };

    function resetValues() {
        // RESET VALUES
        self.currentStage = 0; 
        self.currentQuestion = 0; 
        self.stageType = self.design.type;
        if(self.design.type == "semantic_differential") self.design.phases[0].questions[0].ans_format.values;
        self.busy = false; 
        self.extraOpts = false;
        self.prevStages = false;
    }

    /*
        FRONTEND FUNCTIONS
    */

    self.toggleOpts = function(opt){
        if(opt == 1)self.extraOpts = !self.extraOpts;
        else if(opt == 2) self.prevStages = !self.prevStages;
        
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
        self.num = self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format
            .values;
    };

    self.addQuestion = function(){
        self.design.phases[self.currentStage].questions.push(
            {
                "q_text":     "",
                "ans_format": {
                    "values":          5,
                    "l_pole":          "",
                    "r_pole":          "",
                    "just_required":   true,
                    "min_just_length": 10
                }});
        self.selectQuestion(self.design.phases[self.currentStage].questions.length-1); //send to new question
        self.errorList[self.currentStage].push({q: true,l: true,r: true});
    };

    self.deleteQuestion = function(index){
        if (
            (self.currentQuestion != null) &&
            (self.design.phases[self.currentStage].questions.length != 1)
        ){
            //change question index
            if(index == 0) self.currentQuestion = 0;
            // else if (index < self.design.phases[self.currentStage].questions.length-1)
            //     self.currentQuestion = self.currentQuestion; //! self-assign makes no sense
            else self.currentQuestion = self.currentQuestion -1;
            self.design.phases[self.currentStage].questions.splice(index, 1);
            self.errorList[self.currentStage].splice(index, 1);
            self.selectQuestion(self.currentQuestion);
        }
    };

    self.selectStage = function(id){
        if(self.currentStage != id){
            self.currentStage = id;
            self.stageType = self.design.type;
            self.currentQuestion = 0; //reset question index
            if(self.stageType == "semantic_differential"){  
                self.num = self.design.phases[self.currentStage].questions[self.currentQuestion]
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
        if(self.currentStage != null && self.design.phases.length != 1){
            var index = self.currentStage;
            self.design.phases.splice(index, 1);
            self.currentQuestion = 0; //reset question index
            self.num = null;
            self.currentStage = null;
            self.extraOpts = false;
            self.prevStages = false;
            self.errorList.splice(index, 1);
        }
    };

    self.templateStage = function(){ 
        // UNUSED
        return {
            "mode":      "individual",
            "chat":      false,
            "anonymous": false,
            "questions": [
                {
                    "q_text":     "",
                    "ans_format": {
                        "values":          5,
                        "l_pole":          "",
                        "r_pole":          "",
                        "just_required":   false,
                        "min_just_length": 8
                    }
                }
            ]
        };
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
        var index = self.design.phases.length -1;
        var prev_phase = self.design.phases[index];
        self.design.phases.push(self.copyPrevStage(self.stageType, prev_phase));
        self.errorList.push(JSON.parse(JSON.stringify(self.errorList[index])));
        
    };

    self.getStages = function(){
        return self.design.phases;
    };

    self.amountOptions = function(type){
        self.num = self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format
            .values;
        if(type == "+"){
            self.num = self.num < 9 ? self.num + 1 : 10;
        }
        else{
            self.num = self.num > 2 ? self.num - 1 : 2;
        }
        self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format
            .values = self.num;
    };

    self.init(); //init

};
