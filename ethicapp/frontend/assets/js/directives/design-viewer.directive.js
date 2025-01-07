let designViewerDirective = function() {
    return {
        restrict: 'E',
        scope: {
            design: '<'
        },
        bindToController: true,
        controllerAs: 'ctrl',
        controller: function($scope) {
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