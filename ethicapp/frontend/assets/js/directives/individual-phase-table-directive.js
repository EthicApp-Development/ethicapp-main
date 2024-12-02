import individualResultsTables from "./templates/dashboard-views/dashboard-views-registry.js";

let individualPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',
            designType: '<'
        },
        template: function(element, atts) {
            const template = individualResultsTables[atts.designType];
            if (!template) {
                throw new Error(`Could not find template for design type '${atts.designType}'`);
            }
            return template;
        }
    };
};

export { individualPhaseTableDirective };