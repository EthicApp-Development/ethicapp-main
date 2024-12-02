import groupResultsTables from "./templates/dashboard-views/dashboard-views-registry.js";

let groupPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',
            designType: '<'
        },
        template: function(element, atts) {
            const template = groupResultsTables[atts.designType];
            if (!template) {
                throw new Error(`Could not find template for design type '${atts.designType}'`);
            }
            return template;            
        },
        controller: function($scope) {
            $scope.getUserName = function(userId) {
                const user = $scope.users.find(u => u.id === userId);
                return user ? user.name : 'Unknown';
            };

            $scope.getGroupResponses = function(memberIds, questionId) {
                return memberIds
                    .map(userId => $scope.responses[userId]?.[questionId])
                    .filter(response => response);
            };
        }
    };
};

export { groupPhaseTableDirective };