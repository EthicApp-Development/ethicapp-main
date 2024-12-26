import { groupResultsTables } from "./templates/dashboard/dashboard-views.registry.js";

let groupPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',  // Processed group-phase data
            designType: '<'  // Design type ('ranking', 'semantic_differential', etc.)
        },
        bindToController: true, // Bind the scope properties to the controller
        controllerAs: 'gptCtrl', // Alias for the controller        
        controller: function($scope) {
            const gptCtrl = this;

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
            gptCtrl.calculateGroupStatistics = function(groupData, questions) {
                const calculator = statisticsCalculators[gptCtrl.designType];
                if (!calculator) {
                    throw new Error(`No statistics calculator defined for design type: '${gptCtrl.designType}'`);
                }
                return calculator(groupData, questions);
            };

            // Initialize data
            gptCtrl.initialize = function() {
                if (!gptCtrl.phaseData.state.responses || !gptCtrl.phaseData.descriptor.questions) {
                    console.error("Invalid phase data provided.");
                    return;
                }

                const groupData = gptCtrl.phaseData.state.responses;
                const questions = gptCtrl.phaseData.descriptor.questions;

                // Preprocess data based on the design type
                const processedData = gptCtrl.calculateGroupStatistics(groupData, questions);

                // Update scope with processed data
                gptCtrl.sortedResponses = [...processedData]; // Default sorted responses
            };

            // Lifecycle hook: Reacts to changes in bindings
            gptCtrl.$onChanges = function(changes) {
                if (changes.designType && changes.designType.currentValue) {
                    gptCtrl.designType = changes.designType.currentValue;
                    console.debug(`[individualPhaseTableDirective] Updated designType: ${gptCtrl.designType}`);
                }

                if (changes.phaseData && changes.phaseData.currentValue) {
                    gptCtrl.phaseData = changes.phaseData.currentValue;
                    console.debug(`[groupPhaseTableDirective] Updated phaseData:`, gptCtrl.phaseData);

                    // Only initialize when bindings are ready
                    gptCtrl.initialize();
                }
            };

            // Resolve the template URL dynamically
            gptCtrl.getTemplateUrl = function() {
                if (!gptCtrl.designType) {
                    console.warn(`[groupPhaseTableDirective] Waiting for designType to be ready...`);
                    return '/assets/static/partials/teacher/micro-partials/default-phase-description.html';
                }

                const template = groupResultsTables[gptCtrl.designType];
                if (!template) {
                    console.warn(`[groupPhaseTableDirective] Template not found for design type: ${gptCtrl.designType}`);
                    return `/assets/static/partials/teacher/micro-partials/default-template.html`;
                }
                console.debug(`[groupPhaseTableDirective] Using template: ${template}`);
                return template;
            };            
        },
        template: `
        <div>
            <ng-include src="gptCtrl.getTemplateUrl()"></ng-include>
        </div>`,
    };
};

export { groupPhaseTableDirective };
