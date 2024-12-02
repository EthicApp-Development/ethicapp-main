/*eslint func-style: ["error", "expression"]*/
export function DesignEditController($scope, $routeParams, 
    DesignStateService, $filter, $http, Notification, $timeout, 
    ActivityStateService, DesignCatalogService) {

    const vm = this;

    vm.keyGroups = function (k1, k2) {
        return {
            key:  k1 + (k2 == null ? "" : " " + k2),
            name: k1 + (k2 == null ? "" : " " + k2)
            //name: vm.flang(k1) + (k2 == null ? "" : " " + vm.flang(k2)) FIX TRANSLATION BUG
        };
    };

    vm.currentStage = 0; //index of stage
    vm.currentQuestion = 0; //index of current question
    vm.methods = [
        vm.keyGroups("random"), vm.keyGroups("performance", "homog"),
        vm.keyGroups("performance", "heterg"), 
        vm.keyGroups("knowledgeType", "homog"), vm.keyGroups("knowledgeType", "heterg"), 
        vm.keyGroups("previous")
    ];

    vm.groupType = [vm.keyGroups("individual"), vm.keyGroups("team")];
    vm.busy = false; //upload file
    vm.extraOpts = false;
    vm.documents = null;
    vm.prevStages = false;
    vm.error = false;
    vm.saved = false;
    vm.errorList = [];
    vm.design = null;
    vm.designId = 0;
    vm.selectedOption = "";
    vm.roles = [];

    vm.init = async function() {
        // Retrieve the design from the route path
        if ($routeParams.id !== undefined) {

            const designId = Number($routeParams.id);
            const designObj = await DesignCatalogService.getDesignById(designId);
            
            if (designObj === null) {
                console.error("[DesignEditorController::init] Design not found.");
                $scope.navigateTo("/error/404/2");
            }

            vm.designId = designId;
            
            // Set the newly uploaded design as the current one
            await DesignStateService.setDesign(designId, designObj);

            // Necessary for the views...
            vm.design = designObj;

            // console.log(`[DesignEditorController::init] The design is as follows: ${JSON.stringify(vm.design)}`);
        }

        if(vm.design != null){
            vm.stageType = vm.design.type;
            if(vm.design.type == "semantic_differential") {
                vm.num = vm.design.phases[0].questions[0].ans_format.values;
            }
            vm.resetValues();
            vm.cleanEmptyValues();
            vm.createErrorList();
        }
    };

    vm.cleanEmptyValues = function() {
        // console.log(`cleanEmptyValues vm.design: '${JSON.stringify(vm.design)}'`);
        let phases = vm.design.phases;
        for(let i =0; i< phases.length; i++){
            let phase = phases[i];
            if(vm.stageType == "semantic_differential"){
                let questions = phase.questions;
                for(let j=0; j < questions.length; j++){
                    let question = questions[j];

                    question.q_text = question.q_text === "-->>N/A<<--" ? "" : question.q_text;
                    question.ans_format.l_pole = question.ans_format.l_pole === "-->>N/A<<--" ? "" : question.ans_format.l_pole;
                    question.ans_format.r_pole = question.ans_format.r_pole === "-->>N/A<<--" ? "" : question.ans_format.r_pole;
                }
            }
            else if(vm.stageType == "ranking"){
                let roles = phase.roles;
                phase.q_text = phase.q_text === "-->>N/A<<--" ? "" : phase.q_text;
                for(let j=0; j<roles.length; j++){
                    let role = roles[j];
                    role.name = role.name === "-->>N/A<<--" ? "" : role.name;
                }
            }
        }
    
        return;
    };

    vm.createErrorList = function(){
        //[[{q:false, l:false, t:true}]]
        let phases = vm.design.phases;
        for(let i =0; i< phases.length; i++){
            let phase = phases[i];
            if(vm.stageType == "semantic_differential"){
                let questions = phase.questions;
                let questionsErrorList = [];
                for(let j=0; j<questions.length; j++){
                    let questionErrors = {};
                    let question = questions[j];

                    questionErrors = {
                        q: question.q_text == "",
                        l: question.ans_format.l_pole == "",
                        r: question.ans_format.r_pole ==""
                    };
    
                    questionsErrorList.push(questionErrors);
                }
                vm.errorList.push(questionsErrorList);
            }
            else if(vm.stageType == "ranking"){
                let roles = phase.roles;
                let rolesErrorList = [];
                for(let j=0; j<roles.length; j++){
                    let role = roles[j];

                    rolesErrorList.push(role.name=="");
                }

                vm.errorList.push(rolesErrorList);
            }
        }
    };

    vm.checkPhase = function(phase){ //IF Phase deleted or Question deleted, delete errorList
        if(vm.stageType == "semantic_differential"){
            const questions = vm.errorList[phase];
            let error = false;
            for(let question=0; question<questions.length; question++){
                const questionValues = Object.values(vm.errorList[phase][question]);
                const questionResult = checkIfTrue(questionValues);
                if(questionResult) error = true;
            }
            return error;
        }
        else if(vm.stageType == "ranking"){
            const roles = vm.errorList[phase];
            let error = false;
            if(vm.design.phases[phase].q_text == "") error = true;
            for(let role=0; role<roles.length; role++){

                if(vm.errorList[phase][role]) error = true;
            }
            return error;
        }
    };

    vm.CheckQuestion = function(index){
        if(vm.currentStage !== null){
            const phase = vm.currentStage;
            const questionValues = Object.values(vm.errorList[phase][index]);
            return checkIfTrue(questionValues);
        }
    };

    let checkIfTrue = (arr) => {
        return arr.some(value => value === true);
    };
    
    vm.IsEmpty = function(value, type){
        //check currentStage && currentQuestion to update on the fly
        if(vm.stageType == "semantic_differential" && vm.currentStage !== null || type == ""){
            const isEmpty = value==="";
            const phase = vm.currentStage;
            const question  = vm.currentQuestion;
            if(type !== "") vm.errorList[phase][question][type] = isEmpty;

            return isEmpty;
        }
        
    };

    vm.IsTextEmpty = function(index, value){
        if(vm.stageType == "ranking" && vm.currentStage !== null){
            //check currentStage && currentQuestion to update on the fly
            const isEmpty = value==="";
            const phase = vm.currentStage;
            vm.errorList[phase][index] = isEmpty;
            return isEmpty;
        }
    };

    vm.addRole = function(){
        vm.design.phases[vm.currentStage].roles.push({
            name: "",
            type: "role", //order
            wc:   5
        });
    };

    vm.setRoleType = function(role, type){
        if(role.type == type){
            role.type = null;
            return;
        }
        if(vm.roles.find(e => e.type != null && e.type != type)){
            vm.setAllRolesType(null);
        }

        role.type = type;
    };

    vm.setAllRolesType = function (type) {
        for (let i = 0; i < vm.design.phases[vm.currentStage].roles.length; i++) {
            vm.design.phases[vm.currentStage].roles[i].type = type;
        }
    };

    vm.removeRole = function (index) {
        if (window.confirm("¿Esta seguro de eliminar este rol?")) {
            vm.design.phases[vm.currentStage].roles.splice(index, 1);
        }
    };

    vm.updateDesign = async function() {
        try {
            vm.error = vm.checkDesign();
            if (vm.error) {
                vm.saved = false;
                return vm.saved;
            }

            // console.debug(`[DesignEditorController::updateDesign] designId: ${vm.designId} designObj: ${JSON.stringify(vm.design)}`);
    
            const designId = DesignStateService.getDesignId();
            const result = await DesignCatalogService.updateDesign(designId, vm.design);

            if (result) {
                vm.saved = true;
                $scope.$applyAsync();
            } else {
                vm.saved = false;
            }
        } catch (error) {
            console.error("Error updating design: ", error);
            vm.saved = false;
        }
    
        return vm.saved;
    };
        
    vm.checkDesign = function(){ 
        let error = false;
        let phases = vm.design.phases;
        
        for(let i = 0; i< phases.length; i++){
            let phase = vm.design.phases[i];

            if(vm.design.metainfo.title === "") error = true;

            if(phase.mode == "individual"){
                phase.chat = false;
                phase.anonymous = false;
            }
            if(vm.stageType == "semantic_differential"){
                let questions = phase.questions;
                for(let j=0; j< questions.length; j++){
                    let question = questions[j];
                    if(question.q_text == "") error = true;
                    if(question.ans_format.l_pole == "") error = true;
                    if(question.ans_format.r_pole =="") error = true;
                    if(question.ans_format.min_just_length < 0 ) error = true;
                }
            }
            if(vm.stageType == "ranking"){
                let roles = phase.roles;
                if(phase.q_text == "") error = true;
                for(let j=0; j<roles.length; j++){
                    let role = roles[j];
                    if(role.name == "") error = true;
                }
            }

        }
        return error;
    };  


    vm.resetValues = function() {
        // RESET VALUES
        vm.currentStage = 0; 
        vm.currentQuestion = 0; 
        vm.stageType = vm.design.type;
        if(vm.design.type == "semantic_differential") {
            vm.design.phases[0].questions[0].ans_format.values;
        }
        vm.busy = false; 
        vm.extraOpts = false;
        vm.prevStages = false;
    }

    /*
        FRONTEND FUNCTIONS
    */

    vm.toggleOpts = function(opt){
        if(opt == 1)vm.extraOpts = !vm.extraOpts;
        else if(opt == 2) vm.prevStages = !vm.prevStages;
    };

    vm.buildArray = function (n) {
        let a = [];
        for (let i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };
    
    vm.selectQuestion = function(id){
        vm.currentQuestion = id; 
        vm.num = vm.design.phases[vm.currentStage].questions[vm.currentQuestion].ans_format
            .values;
    };

    vm.addQuestion = function(){
        vm.design.phases[vm.currentStage].questions.push(
            {
                "q_text":     "",
                "ans_format": {
                    "values":          5,
                    "l_pole":          "",
                    "r_pole":          "",
                    "just_required":   true,
                    "min_just_length": 10
                }});
        vm.selectQuestion(vm.design.phases[vm.currentStage].questions.length-1); //send to new question
        vm.errorList[vm.currentStage].push({q: true,l: true,r: true});
    };

    vm.deleteQuestion = function(index){
        if (
            (vm.currentQuestion != null) &&
            (vm.design.phases[vm.currentStage].questions.length != 1)
        ){
            //change question index
            if(index == 0) vm.currentQuestion = 0;
            // else if (index < vm.design.phases[vm.currentStage].questions.length-1)
            //     vm.currentQuestion = vm.currentQuestion; //! vm-assign makes no sense
            else vm.currentQuestion = vm.currentQuestion -1;
            vm.design.phases[vm.currentStage].questions.splice(index, 1);
            vm.errorList[vm.currentStage].splice(index, 1);
            vm.selectQuestion(vm.currentQuestion);
        }
    };

    vm.selectStage = function(id){
        if(vm.currentStage != id){
            vm.currentStage = id;
            vm.stageType = vm.design.type;
            vm.currentQuestion = 0; //reset question index
            if(vm.stageType == "semantic_differential"){  
                vm.num = vm.design.phases[vm.currentStage].questions[vm.currentQuestion]
                    .ans_format.values;
            }
        }
        else {
            /*
            vm.currentStage = null; //unselect current stage
            vm.num = null;
            vm.stageType  = null;
            */
        }
        vm.extraOpts = false;
        vm.prevStages = false;
        //console.log(vm.methods);
    };

    vm.deleteStage = function(){
        if(vm.currentStage != null && vm.design.phases.length != 1){
            let index = vm.currentStage;
            vm.design.phases.splice(index, 1);
            vm.currentQuestion = 0; //reset question index
            vm.num = null;
            vm.currentStage = null;
            vm.extraOpts = false;
            vm.prevStages = false;
            vm.errorList.splice(index, 1);
        }
    };

    vm.templateStage = function(){ 
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
    
    vm.copyPrevStage = function(type, prevphase){
        let phase = JSON.parse(JSON.stringify(prevphase)); //removes reference from previous object
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

    vm.addStage = function(){
        const index = vm.design.phases.length -1;
        const prev_phase = vm.design.phases[index];
        vm.design.phases.push(vm.copyPrevStage(vm.stageType, prev_phase));
        vm.errorList.push(JSON.parse(JSON.stringify(vm.errorList[index])));
    };

    vm.getStages = function() {
        if (vm.design == null) {
            return [];
        }    
        return vm.design.phases;
    };

    vm.amountOptions = function(type) {
        vm.num = vm
            .designObj.phases[vm.currentStage]
            .questions[vm.currentQuestion]
            .ans_format
            .values;
        if(type == "+"){
            vm.num = vm.num < 9 ? vm.num + 1 : 10;
        }
        else{
            vm.num = vm.num > 2 ? vm.num - 1 : 2;
        }
        vm.design.phases[vm.currentStage].questions[vm.currentQuestion].ans_format
            .values = vm.num;
    };

    vm.init();
};
