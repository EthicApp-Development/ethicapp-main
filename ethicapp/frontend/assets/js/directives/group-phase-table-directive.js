import groupResultsTables from "./templates/dashboard-views/dashboard-views-registry.js";

let groupPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',  // Processed group-phase data
            designType: '<'  // Design type ('ranking', 'semantic_differential', etc.)
        },
        template: function(element, atts) {
            const template = groupResultsTables[atts.designType];
            if (!template) {
                throw new Error(`Could not find template for design type '${atts.designType}'`);
            }
            return template;
        },
        controller: function($scope) {
            // Define statistics calculators for each design type
            const statisticsCalculators = {
                ranking: function(groupData, questions) {
                    // Group data by groupNumber
                    const groupedData = groupData.reduce((acc, user) => {
                        const groupNumber = user.groupNumber || 'Ungrouped';
                        if (!acc[groupNumber]) acc[groupNumber] = [];
                        acc[groupNumber].push(user);
                        return acc;
                    }, {});

                    // Add total chat messages per group
                    Object.keys(groupedData).forEach(groupNumber => {
                        const groupMembers = groupedData[groupNumber];
                        const totalChatCount = groupMembers.reduce(
                            (sum, member) => sum + (member.totalChatCount || 0),
                            0
                        );

                        // Assign totalChatCount to each member for display
                        groupMembers.forEach(member => {
                            member.groupChatMessages = totalChatCount;
                        });
                    });

                    // Flatten grouped data back into a single array
                    return Object.values(groupedData).flat();
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

            // General function to calculate statistics based on design type
            $scope.calculateGroupStatistics = function(groupData, questions) {
                const calculator = statisticsCalculators[$scope.designType];
                if (!calculator) {
                    throw new Error(`No statistics calculator defined for design type: '${$scope.designType}'`);
                }
                return calculator(groupData, questions);
            };

            // Initialize data
            $scope.initialize = function() {
                const groupData = $scope.phaseData.state.responses;
                const questions = $scope.phaseData.descriptor.questions;

                // Preprocess data based on the design type
                const processedData = $scope.calculateGroupStatistics(groupData, questions);

                // Update scope with processed data
                $scope.sortedResponses = [...processedData]; // Default sorted responses
            };

            // Call initialize when directive is loaded
            $scope.initialize();
        }
    };
};

export { groupPhaseTableDirective };
