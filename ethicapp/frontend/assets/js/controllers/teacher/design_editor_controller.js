/*eslint func-style: ["error", "expression"]*/
import * as sdModule from "../../libs/designs/semantic_differential.js";
import * as rnkModule from "../../libs/designs/ranking.js";
import * as gaModule from "../../libs/designs/grouping_algorithms.js"

export let DesignEditorController = ($scope, DesignsService,
    ActivitiesService, 
    $filter, $http, Notification, $timeout) => {
    var self = $scope;

    self.init = () => {
        self.groupingAlgorithms = gaModule.getGroupingAlgorithmLabels();
        self.interactionTypes = gaModule.getInteractionTypes();
        $scope.$on('DesignsService_workingDesignUpdated', (event, data) => {
            resetEditorState();
        })
        resetEditorState();
    };

    self.resetEditorState = () => {
        if (DesignsService.workingDesign == null) {
            throw new Error("[DesignEditorController] Got a null design from DesignsService!");
        }        
        resetValues();
        self.cleanEmptyValues();
        self.createErrorList();
    }

    let resetValues = () => {
        self.design = DesignsService.workingDesign;
        self.currentStage = 0;      // Index of stage being edited
        self.currentQuestion = 0;   // Index of question being edited
        self.stageType = DesignsService.workingDesign.type ?? undefined;
        
        if(self.stageType == "semantic_differential") {
            self.sdScaleTicks = DesignsService.workingDesign
                .phases[0].questions[0].ans_format.values;
        }

        self.busy = false;          // State for file uploads
        self.extraOpts = false;
        self.prevStages = false;

        self.error = false;
        self.saved = false;
        self.errorList = [];
        self.selectedOption = "";
        self.roles = [];
    };

    self.cleanEmptyValues = () => {        
        let funcs = {
            "semantic_differential" : (phase) => {
                phase.questions.map(question => {
                    question.q_text = question.q_text === "-->>N/A<<--" ? "" : question.q_text;
                    question.ans_format.l_pole = question.ans_format.l_pole === "-->>N/A<<--" ? 
                        "" : question.ans_format.l_pole;
                    question.ans_format.r_pole = question.ans_format.r_pole === "-->>N/A<<--" ? 
                        "" : question.ans_format.r_pole;
                });
            },
            "ranking" : (phase) => {
                phase.q_text = phase.q_text === "-->>N/A<<--" ? "" : phase.q_text;
                phase.roles.map(role => {
                    role.name = role.name === "-->>N/A<<--" ? "" : role.name;
                });
            }
        }

        let phases = DesignsService.workingDesign.phases;

        if (!(self.stageType in funcs)) {
            throw new Error("[DesignEditorController.cleanEmptyValues] Error: a function for " + 
                "the current phase type was not found");
        }        
        
        phases.map(phase => {
            funcs[self.stageType](phase);
        });
    };

    self.createErrorList = () => {
        //[[{q:false, l:false, t:true}]]
        let funcs = {
            "semantic_differential" : (phase) => {
                let questionsErrorList = [];
                let questions = phase.questions;

                questions.map((question) => {
                    let questionErrors = {};
                    questionErrors = {
                        q: question.q_text == "",
                        l: question.ans_format.l_pole == "",
                        r: question.ans_format.r_pole == ""
                    };
                    questionsErrorList.push(questionErrors);                    
                });
                return questionsErrorList;
            },
            "ranking" : (phase) => {
                let roles = phase.roles;
                let rolesErrorList = [];
                roles.map(role => {
                    var role = roles[j];
                    rolesErrorList.push(role.name=="");
                });
                return rolesErrorList;
            }
        };

        if (!(self.stageType in funcs)) {
            throw new Error("[DesignEditorController.createErrorList] Error: a function for the" +
                " current phase type was not found");
        }

        self.errorList = [];
        let phases = DesignsService.workingDesign.phases;
        
        phases.map(phase => {
            let errors = funcs[self.stageType](phase);    
            self.errorList.push(errors);
        })
    };

    self.validatePhase = (phase) => { // IF Phase deleted or Question deleted, delete errorList
        let validators = {
            "semantic_differential" : (phase, errorList) => {
                const errors = self.errorList[phase];
                let error = false;
                errors.map((_error, index) => {
                    const errorValues = Object.values(errorList[phase][index]);
                    const errorResult = errorValues.some(value => value === true);
                    error = errorResult; // boolean value
                });
                return error;
            },
            "ranking" : (phase, errorList) => {
                const errors = errorList[phase];
                let error = DesignsService.workingDesign.phases[phase].q_text == "";
                errors.map((_error, index) => {
                    error = self.errorList[phase][index];
                });
                return error;
            }
        }

        if (!(self.stageType in validators)) {
            throw new Error("[DesignEditorController.validatePhase] Error: a function for the" +
                " current phase type was not found");
        }

        return validators[self.stageType](phase, self.errorList);
    };

    self.validateQuestion = (index) => {
        try {
            const phase = self.currentStage;
            const questionValues = Object.values(self.errorList[phase][index]);
            return questionValues.some(value => value === true);
        }
        catch (error) {
            console.log("[DesignEditorController] warning: the current stage is not set!");
            return false;
        }
    };
    
    self.isEmpty = (value, type) => {
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

    self.isTextEmpty = (index, value) => {
        if (self.stageType == "ranking" && self.currentStage !== null){
            const _isEmpty = value==="";
            const phase = self.currentStage;
            self.errorList[phase][index] = _isEmpty;
            return _isEmpty;
        }
    };

    self.launchDesignFromEditor = () => {
        self.saveDesign().then((saved) => {
            if (!saved) {
                throw new Error("[DesignEditorController.launchDesignFromEditor] ");
            }

            ActivitiesService.currentActivityState.id = DesignsService
                .workingDesign.id;
            ActivitiesService.currentActivityState.title = DesignsService
                .workingDesign
                .metainfo.title;
            ActivitiesService.currentActivityState.type = DesignsService
                .workingDesign
                .type;

            self.selectView("launchActivity");
        });
    };

    self.addRole = () => {
        DesignsService.workingDesign.phases[self.currentStage].roles.push({
            name: "",
            type: "role", //order
            wc:   5
        });
    };

    self.setRoleType = (role, type) => {
        if(role.type == type){
            role.type = null;
            return;
        }
        if(self.roles.find(e => e.type != null && e.type != type)){
            self.setAllRolesType(null);
        }

        role.type = type;
    };

    self.setAllRolesType = (type) => {
        let roles = DesignsService.workingDesign
            .phases[self.currentStage]
            .roles;

        roles.map(role => {
            role.type = type;
        });
    };

    self.removeRole = (index) => {
        if (window.confirm("¿Esta seguro de eliminar este rol?")) {
            DesignsService.workingDesign
                .phases[self.currentStage].roles.splice(index, 1);
        }
    };

    self.saveDesign = () => {
        self.error = self.validateDesign();
        self.saved = false;

        if (self.error) {
            throw new ("[DesignEditorController.saveDesign] Failed to update design due to " +
                "validation errors");
        }

        // Avoid saving the design object containing id field
        let { id, ...design } = DesignsService.workingDesign;

        DesignsService.updateDesign(id, design).then(result => {
            self.saved = true;
        }).catch(error => {
            self.saved = false;
            console.log("[DesignEditorController.saveDesign] Failed to save design");
            Notification.error("No se pudo guardar el diseño");
        });
    };

    self.saveBlankDesign = (title, author, type) => {
        let designs = {
            "semantic_differential": sdModule.getBlankDesign,
            "ranking":               rnkModule.getBlankDesign
        };
        
        if (!(type in designs)) {
            throw Error("[DesignEditorController.saveBlankDesign] Design type not found");
        }
        
        let blankDesign = designs[type](title, author);
        
        return DesignsService.createDesign(blankDesign).then(id => {
            DesignsService.loadUserDesignById(id).then(design => {
                return Promise.resolve(true);
            }).catch(error => {
                console.log("[DesignEditorController.saveBlankDesign] Failed to upload blank" +
                    `design: ${error}`);
                Notification.error("No se pudo crear un diseño nuevo para editar");
                return false;
            });
        })
    };    

    self.validateDesign = () => { 
        let error = false;
        let phases = DesignsService.workingDesign.phases;

        phases.map((phase) => {
            error = DesignsService.workingDesign.metainfo.title === "";

            // Avoid activation of chat or anonymous variables if the phase is individual.
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

    self.getDesignId = () => {
        return DesignsService.workingDesign.id;
    };

    self.getDesign = () => {
        return DesignsService.workingDesign;
    };


    /*
        FRONTEND FUNCTIONS
    */

    self.toggleOpts = (opt) => {
        if (opt == 1) {
            self.extraOpts = !self.extraOpts;
        }
        else if (opt == 2) {
            self.prevStages = !self.prevStages;
        }
    };

    self.buildArray = (n) => {
        let a = [];
        for (var i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };
    
    self.selectQuestion = (index) => {
        self.currentQuestion = index;
        
        // Update the scale
        self.sdScaleTicks = DesignsService.workingDesign
            .phases[self.currentStage]
            .questions[self.currentQuestion].ans_format
            .values;
    };

    self.addQuestion = () => {
        // Add a blank question
        DesignsService.workingDesign
            .phases[self.currentStage].questions.push(sdModule.getBlankQuestion());
        
        // Select the blank question just added
        self.selectQuestion(DesignsService.workingDesign
            .phases[self.currentStage]
            .questions
            .length-1);
        self.errorList[self.currentStage].push({q: true,l: true,r: true});
    };

    self.deleteQuestion = (index) => {
        // Requires that the current question is set and there is more than one question available
        if (self.currentQuestion != null &&
            DesignsService.workingDesign
                .phases[self.currentStage].questions.length != 1)
        {
            // Change question index as needed
            if (index == 0) {
                self.currentQuestion = 0;
            }
            else { 
                self.currentQuestion = self.currentQuestion - 1;
            }
            DesignsService.workingDesign
                .phases[self.currentStage].questions.splice(index, 1);
            self.errorList[self.currentStage].splice(index, 1);
            self.selectQuestion(self.currentQuestion);
        }
    };

    self.selectStage = (index) => {
        if (self.currentStage != index) {
            self.currentStage = index;
            self.stageType = DesignsService.workingDesign.type;
            self.currentQuestion = 0; // reset question index
            
            if (self.stageType == "semantic_differential") {  
                // Update the scale
                self.sdScaleTicks = DesignsService.workingDesign.phases[self.currentStage]
                    .questions[self.currentQuestion]
                    .ans_format.values;
            }
        }
        else {
            /*
            self.currentStage = null; //unselect current stage
            self.sdScaleTicks = null;
            self.stageType  = null;
            */
        }
        self.extraOpts = false;
        self.prevStages = false;
    };

    self.deleteStage = () => {
        if (self.currentStage != null && DesignsService.workingDesign
            .design.phases.length != 1) {
            let index = self.currentStage;
            DesignsService.workingDesign.phases.splice(index, 1);
            self.currentQuestion = 0; //reset question index
            self.sdScaleTicks = null;
            self.currentStage = null;
            self.extraOpts = false;
            self.prevStages = false;
            self.errorList.splice(index, 1);
        }
    };
    
    self.copyPrevStage = (type, prevphase) => {
        // Serializes the object and re-instances it with new references to members
        var phase = JSON.parse(JSON.stringify(prevphase));
        
        let copyFunctions = {
            "semantic_differential": sdModule.copyPhase,
            "ranking":               rnkModule.copyPhase
        };        
        
        if (!(type in copyFunctions)) {
            throw Error("[DesignEditorController.copyPrevStage] Design type not found");
        }        

        return copyFunctions[type](phase);
    };

    self.addStage = () => {
        let index = DesignsService.workingDesign.phases.length - 1;
        let prev_phase = DesignsService.workingDesign.phases[index];
        
        DesignsService.workingDesign
            .phases.push(self.copyPrevStage(self.stageType, prev_phase));
        self.errorList.push(JSON.parse(JSON.stringify(self.errorList[index])));
    };

    self.getStages = () => {
        return DesignsService.workingDesign.phases;
    };

    self.updateScaleValues = (operation) => {
        // Get the current number of scale values in the current question being edited.
        self.sdScaleTicks = DesignsService.workingDesign
            .phases[self.currentStage]
            .questions[self.currentQuestion]
            .ans_format
            .values;
        
        // Increment the number of scale values.
        if (operation == "+") {
            self.sdScaleTicks = self.sdScaleTicks < 9 ? self.sdScaleTicks + 1 : 10;
        }
        // Decrement it.
        else {
            self.sdScaleTicks = self.sdScaleTicks > 2 ? self.sdScaleTicks - 1 : 2;
        }

        // Update the working design
        DesignsService.workingDesign.phases[self.currentStage]
            .questions[self.currentQuestion]
            .ans_format
            .values = self.sdScaleTicks;
    };

    self.init();
};
