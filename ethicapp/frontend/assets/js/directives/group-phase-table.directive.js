import { addDifferentialGroupStatistics, addRankingGroupChatCounts } from "../helpers/group-phase-statistics.js";
import { detailRowKey, isRowActivationKey, isRowInDetail } from "../helpers/response-detail.js";
import { groupResultsTables } from "./templates/dashboard/dashboard-views.registry.js";

let groupPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',  // Processed group-phase data
            designType: '<',  // Design type ('ranking', 'semantic_differential', etc.)
            participantQuery: "<?",  // The dashboard's participant search (#894)
            questionTexts:    "<?",  // The questions' text for the column headers (#895)
            detailSelection:  "<?",  // What the response detail panel shows (#896)
            onSelectResponse: '&?',
            onSelectGroup: '&?'
        },
        bindToController: true, // Bind the scope properties to the controller
        controllerAs: 'gptCtrl', // Alias for the controller        
        controller: function($scope) {
            const gptCtrl = this;

            // The per-group figures for each design type (#919: students
            // without a group form no group).
            const statisticsCalculators = {
                ranking: addRankingGroupChatCounts,
                semantic_differential: addDifferentialGroupStatistics,
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

            // The response detail panel (#896): its rows are highlighted,
            // each row is known by its key so the focus can come back to it,
            // and Enter or Space opens a row as a click does.
            gptCtrl.isRowInDetail = function(row) {
                return isRowInDetail(gptCtrl.detailSelection, row);
            };

            gptCtrl.detailKey = function(row) {
                return detailRowKey(row);
            };

            gptCtrl.onRowKeydown = function(event, row) {
                if (isRowActivationKey(event)) {
                    event.preventDefault();
                    gptCtrl.onRowClick(row);
                }
            };

            gptCtrl.onRowClick = function(row) {
                if (gptCtrl.designType !== 'semantic_differential') {
                    return;
                }

                if (row?.groupStatistics && typeof gptCtrl.onSelectGroup === 'function') {
                    gptCtrl.onSelectGroup({
                        group: row,
                        phaseData: gptCtrl.phaseData,
                    });
                    return;
                }

                if (!row?.groupStatistics && typeof gptCtrl.onSelectResponse === 'function') {
                    gptCtrl.onSelectResponse({
                        response: row,
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
