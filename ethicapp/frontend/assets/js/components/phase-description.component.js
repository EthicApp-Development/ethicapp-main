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

let phaseDescriptionComponent = {
    bindings: {
        phaseData: '<',
        designObject: '<'
    },
    controller: function() {
        const ctrl = this;

        ctrl.getTemplate = function() {
            const designType = ctrl.designObject.type;
            const template = phaseDescriptionTemplatesRegistry[designType];
            return template || `
                <p>{{ 'unsupported_design_type_label' | translate }}: {{ $ctrl.designObject.type }}</p>
            `;
        };

        ctrl.$onInit = function() {

            // Access phase details from designObject using phase number
            const phaseNumber = ctrl.phaseData.descriptor.number;
            ctrl.phaseDetails = ctrl.designObject.phases[phaseNumber - 1];

            if (!phaseNumber || !ctrl.phaseDetails) {
                console.error(`Invalid phase number or missing phase details for phase number: ${phaseNumber}`);
                return;
            }

            ctrl.phaseMode = ctrl.phaseDetails.mode;

            // Process data based on phase type
            const designType = ctrl.designObject.type;
            const transformer = designTransformers[designType];
            
            if (!transformer) {
                console.warn(`Unsupported phase type: ${designType}`);
                return;
            }

            transformer(ctrl);
        };        
    },
    template: function(elem, atts, ctrl) {
        return ctrl.getTemplate();
    } 
};

export { phaseDescriptionComponent };