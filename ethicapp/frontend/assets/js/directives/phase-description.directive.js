import phaseDescriptionTemplatesRegistry from "./templates/dashboard/phase-description-templates.registry.js";

let designTransformers = {
    semantic_differential: transformSemanticDifferentialPhase,
    ranking: transformRankingPhase
};

function transformSemanticDifferentialPhase(ctrl) {
    ctrl.phaseQuestions = ctrl.phaseDetails.questions.map(q => ({
        text: q.q_text,
        leftPole: q.ans_format.l_pole,
        rightPole: q.ans_format.r_pole,
        range: q.ans_format.values,
        justificationRequired: q.ans_format.just_required,
        minJustificationLength: q.ans_format.min_just_length
    }));
}

function transformRankingPhase(ctrl) {
    ctrl.phaseActors = ctrl.phaseDetails.roles.map(actor => ({
        name: actor.name,
        justificationRequired: actor.type === 'order',
        minJustificationLength: actor.wc || 0
    }));
}

const phaseDescriptionDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseNumber: '<',
            designObject: '<'
        },
        bindToController: true,
        controllerAs: 'ctrl',
        controller: function($scope) {
            const ctrl = this;
        
            ctrl.$onInit = function() {            
                const phaseNumber = ctrl.phaseNumber;
                if (!phaseNumber) {
                    console.error(`[phaseDescription] Invalid phase number: ${phaseNumber}`);
                    return;
                }
    
                ctrl.phaseDetails = ctrl.designObject.phases[phaseNumber - 1];
                if (!ctrl.phaseDetails) {
                    console.error(`[phaseDescription] Missing phase details for phase number: ${phaseNumber}`);
                    return;
                }
    
                ctrl.phaseMode = ctrl.phaseDetails.mode;
    
                const designType = ctrl.designObject.type;
                const transformer = designTransformers[designType];
    
                if (!transformer) {
                    console.warn(`[phaseDescription] Unsupported phase type: ${designType}`);
                    return;
                }
                
                $scope.$applyAsync(() => transformer(ctrl));
            };

            ctrl.getTemplateUrl = function() {
                if (!ctrl.designObject || !ctrl.designObject.type) {
                    // console.warn(`[phaseDescription] Waiting for designObject to be ready...`);
                    return '/assets/static/views/teacher/fragments/default-phase-description.html';
                }

                const templateUrl = phaseDescriptionTemplatesRegistry[ctrl.designObject.type];
                if (!templateUrl) {
                    console.error(`[phaseDescription] No template found for design type: ${ctrl.designObject.type}`);
                    return '/assets/static/views/teacher/fragments/default-phase-description.html';
                }
                return templateUrl;
            };            
        },
        template: '<div ng-include="ctrl.getTemplateUrl()"></div>'
    };
};

export { phaseDescriptionDirective };
