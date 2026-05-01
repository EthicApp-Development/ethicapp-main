import { groupResultsTables } from "./templates/dashboard/dashboard-views.registry.js";

let groupPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',  // Processed group-phase data
            designType: '<',  // Design type ('ranking', 'semantic_differential', etc.)
            onSelectGroup: '&?'
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
                semantic_differential: function (participantData, questions) {
                    // Filter out individual participant data and group it by `groupNumber`
                    const individualData = participantData.filter(participant => !participant.groupStatistics);
                    const groupMap = individualData.reduce((acc, participant) => {
                        const groupNumber = participant.groupNumber || 'Ungrouped';
                        if (!acc[groupNumber]) acc[groupNumber] = [];
                        acc[groupNumber].push(participant);
                        return acc;
                    }, {});
            
                    // Calculate statistics for each group
                    Object.keys(groupMap).forEach(groupNumber => {
                        const members = groupMap[groupNumber];
                        const stats = {};
            
                        // Calculate average and coefficient of variation (CV) for each question
                        questions.forEach((question, index) => {
                            const key = `r${index + 1}`;
                            const values = members.map(member => member[key]).filter(v => v !== null);
            
                            if (values.length > 0) {
                                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                                const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
                                const stdDev = Math.sqrt(variance);
                                const cv = avg !== 0 ? (stdDev / avg) : 0;
            
                                // Add calculated average and CV to stats object
                                stats[`averageR${index + 1}`] = avg.toFixed(2);
                                stats[`cvR${index + 1}`] = cv.toFixed(2);
                            } else {
                                // Default values if no data is available
                                stats[`averageR${index + 1}`] = '-';
                                stats[`cvR${index + 1}`] = '-';
                            }
                        });
            
                        // Locate or create the `groupStatistics` object for this group
                        let groupStatsObject = participantData.find(obj => obj.groupStatistics && 
                            obj.groupNumber === Number(groupNumber));
                        if (!groupStatsObject) {
                            // If the object does not exist, create and add it
                            groupStatsObject = { groupStatistics: true, groupNumber, stats: {} };
                            participantData.push(groupStatsObject);
                        }
            
                        // Update the `groupStatistics` object with the calculated stats
                        Object.assign(groupStatsObject, stats);
                    });
            
                    // Return the updated participantData with `groupStatistics` objects in their original positions
                    return participantData;
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
                if (!gptCtrl.phaseData.state || !gptCtrl.phaseData.descriptor.questions) {
                    console.error("Invalid phase data provided.");
                    return;
                }

                const participantData = gptCtrl.phaseData.state;
                const questions = gptCtrl.phaseData.descriptor.questions;

                // Preprocess data based on the design type
                gptCtrl.calculateGroupStatistics(participantData, questions);
            };

            gptCtrl.getParticipantCount = function() {
                return gptCtrl.phaseData?.state.filter(pd => !pd.groupStatistics).length ?? 0;
            };

            // Lifecycle hook: Reacts to changes in bindings
            gptCtrl.$onChanges = function(changes) {
                if (changes.designType && changes.designType.currentValue) {
                    gptCtrl.designType = changes.designType.currentValue;
                    // console.debug(`[individualPhaseTableDirective] Updated designType: ${gptCtrl.designType}`);
                }

                if (changes.phaseData && changes.phaseData.currentValue) {
                    gptCtrl.phaseData = changes.phaseData.currentValue;
                    // console.debug(`[groupPhaseTableDirective] Updated phaseData:`, gptCtrl.phaseData);

                    // Only initialize when bindings are ready
                    gptCtrl.initialize();
                }
            };

            // Resolve the template URL dynamically
            gptCtrl.getTemplateUrl = function() {
                if (!gptCtrl.designType) {
                    console.warn(`[groupPhaseTableDirective] Waiting for designType to be ready...`);
                    return '/assets/static/views/teacher/fragments/default-phase-description.html';
                }

                const template = groupResultsTables[gptCtrl.designType];
                if (!template) {
                    console.warn(`[groupPhaseTableDirective] Template not found for design type: ${gptCtrl.designType}`);
                    return `/assets/static/views/teacher/fragments/default-template.html`;
                }
                return template;
            };

            gptCtrl.onGroupRowClick = function(group) {
                if (gptCtrl.designType !== 'semantic_differential' || !group?.groupStatistics) {
                    return;
                }

                if (typeof gptCtrl.onSelectGroup === 'function') {
                    gptCtrl.onSelectGroup({
                        group,
                        phaseData: gptCtrl.phaseData,
                    });
                }
            };
        },
        template: `
        <div>
            <ng-include src="gptCtrl.getTemplateUrl()"></ng-include>
        </div>`,
    };
};

export { groupPhaseTableDirective };
