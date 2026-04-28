import { individualResultsTables } from "./templates/dashboard/dashboard-views.registry.js";

let individualPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',
            designType: '<',
            onSelectResponse: '&?'
        },
        bindToController: true, // Bind the scope properties to the controller
        controllerAs: 'iptCtrl', // Alias for the controller
        controller: function($scope) {
            const iptCtrl = this;

            // Preprocessing strategies for different design types
            const preProcessStrategies = {
                ranking: function(data) {
                    const clusterCounts = {};
                    data.forEach(response => {
                        const cluster = response.responseCluster;
                        clusterCounts[cluster] = (clusterCounts[cluster] || 0) + 1;
                    });

                    return data.map(response => ({
                        ...response,
                        clusterCount: clusterCounts[response.responseCluster]
                    }));
                },
                semantic_differential: function(data) {
                    return data; // No preprocessing needed for semantic differential
                }
            };

            // Preprocess data based on the design type
            iptCtrl.preProcessData = function(data, designType) {
                const strategy = preProcessStrategies[designType];
                if (!strategy) {
                    throw new Error(`No preprocessing strategy for design type '${designType}'`);
                }
                return strategy(data);
            };

            // Initialize the directive's state
            iptCtrl.initialize = function() {
                if (!iptCtrl.phaseData ||
                    !iptCtrl.phaseData.state ||
                    !iptCtrl.phaseData.descriptor) {
                    console.error("Invalid phase data structure provided.");
                    iptCtrl.sortedResponses = [];
                    iptCtrl.totalChatMessages = 0;
                    return;
                }

                const questions = iptCtrl.phaseData.descriptor.questions || [];
                if (questions.length === 0) {
                    console.warn("No questions available for this phase.");
                    iptCtrl.sortedResponses = [];
                    iptCtrl.totalChatMessages = 0;
                    return;
                }

                const processedData = iptCtrl.preProcessData(
                    iptCtrl.phaseData.state,
                    iptCtrl.designType);

                iptCtrl.phaseData.state = processedData;
                iptCtrl.sortedResponses = [...processedData];
                iptCtrl.totalChatMessages = processedData.reduce((acc, response) =>
                    acc + Number(response.chatCount || 0), 0);
            };

            // Lifecycle hook: Called when the directive is initialized
            iptCtrl.$onInit = function() {
                iptCtrl.initialize();
            };

            // Lifecycle hook: Reacts to changes in bindings
            iptCtrl.$onChanges = function(changes) {
                if (changes.designType && changes.designType.currentValue) {
                    iptCtrl.designType = changes.designType.currentValue;
                    // console.debug(`[individualPhaseTableDirective] Updated designType: ${iptCtrl.designType}`);
                }

                if (changes.phaseData && changes.phaseData.currentValue) {
                    iptCtrl.phaseData = changes.phaseData.currentValue;
                    // console.debug(`[individualPhaseTableDirective] Updated phaseData:`, iptCtrl.phaseData);
                    iptCtrl.initialize();
                }
            };

            // Resolve the template URL dynamically
            iptCtrl.getTemplateUrl = function() {
                if (!iptCtrl.designType) {
                    console.warn(`[individualPhaseTableDirective] Waiting for designType to be ready...`);
                    return '/assets/static/views/teacher/fragments/default-phase-description.html';
                }

                const template = individualResultsTables[iptCtrl.designType];
                if (!template) {
                    console.warn(`[individualPhaseTableDirective] Template not found for design type: ${iptCtrl.designType}`);
                    return `/assets/static/views/teacher/fragments/default-template.html`;
                }
                return template;
            };

            iptCtrl.onResponseRowClick = function(response) {
                if (iptCtrl.designType !== 'semantic_differential') {
                    return;
                }

                if (typeof iptCtrl.onSelectResponse === 'function') {
                    iptCtrl.onSelectResponse({
                        response,
                        phaseData: iptCtrl.phaseData,
                    });
                }
            };
        },
        template: `
            <div>
                <ng-include src="iptCtrl.getTemplateUrl()"></ng-include>
            </div>
        `,
    };
};

export { individualPhaseTableDirective };
