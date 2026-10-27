let designViewerDirective = function() {
    return {
        restrict: "E",
        scope:    {
            design:        "<",
            // The case's videos (#785), for the videos in the phase texts.
            caseVideos:    "<",
            // The claim typology of the tutor questions, by phase (#849).
            claimTypology: "<",
        },
        bindToController: true,
        controllerAs:     "ctrl",
        controller:       function($scope) {
            const ctrl = this;

            ctrl.$onInit = function() {

            };

            ctrl.$onChanges = function(changes) {
                if (changes.design) {
                    ctrl.design = changes.design.currentValue;
                }
            };            

            ctrl.getTemplateUrl = function() {
                if (!ctrl.design) {
                    // console.warn(`[designViewerDirective] Waiting for designObject to be ready...`);
                }                
                return "/assets/static/views/teacher/fragments/design-viewer.template.html";
            };
            
        },
        template: '<div ng-include="ctrl.getTemplateUrl()"></div>'
    };
};

export { designViewerDirective };