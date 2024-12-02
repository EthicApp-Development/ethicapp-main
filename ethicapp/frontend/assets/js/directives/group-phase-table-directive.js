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
            const statisticsCalculators = {
                ranking: function(groupData, questions) {

                },
                semantic_differential: function(groupData, questions) {
                    const stats = {};
                    questions.forEach((question, index) => {
                        const key = `r${index + 1}`;
                        const chatKey = `chatR${index + 1}`;
                        const values = groupData.map(user => user[key]).filter(v => v !== null);
        
                        const avg = values.reduce((a, b) => a + b, 0) / values.length || 0;
        
                        stats[`averageR${index + 1}`] = avg.toFixed(2);
                        stats[chatKey] = groupData.reduce((sum, user) => sum + (user[chatKey] || 0), 0);
                    });
                    stats.totalChatCount = groupData.reduce((sum, user) => sum + (user.totalChatCount || 0), 0);
                    return stats;
                }
            };
        
            $scope.calculateGroupStatistics = function(groupData, questions) {
                const calculator = statisticsCalculators[$scope.designType];
                if (!calculator) {
                    throw new Error(`No statistics calculator defined for design type: '${$scope.designType}'`);
                }
                return calculator(groupData, questions);
            };
        }
    };
};

export { groupPhaseTableDirective };