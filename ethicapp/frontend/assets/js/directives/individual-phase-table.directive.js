import { individualResultsTables } from "./templates/dashboard/dashboard-views.registry.js";

let individualPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseData: '<',  // Processed data directly passed to the directive
            designType: '<'  // Design type (e.g., 'ranking', 'semantic_differential')
        },
            template: function(element, atts) {
            return individualResultsTables[atts.designType] || `<p>Template not found for '${atts.designType}'</p>`;
        },
        controller: function($scope) {
            // Preprocessing strategies for different design types
            const preProcessStrategies = {
                ranking: function(data) {
                    // Calculate cluster frequencies for ranking design
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
                    // No preprocessing required for semantic differential
                    return data;
                }
                // Additional design types can be added here
            };

            // Abstract method to preprocess data based on the design type
            $scope.preProcessData = function(data, designType) {
                const strategy = preProcessStrategies[designType];
                if (!strategy) {
                    throw new Error(`No pre-processing strategy defined for design type '${designType}'`);
                }
                return strategy(data);
            };

            // Sort responses dynamically based on a selected field
            $scope.sortBy = function(field) {
                $scope.reverse = $scope.sortField === field ? !$scope.reverse : false;
                $scope.sortField = field;
                $scope.sortedResponses = [...$scope.phaseData.state.responses].sort((a, b) => {
                    if (a[field] < b[field]) return $scope.reverse ? 1 : -1;
                    if (a[field] > b[field]) return $scope.reverse ? -1 : 1;
                    return 0;
                });
            };

            $scope.initialize = function() {
                if (!$scope.phaseData || !$scope.phaseData.state || !$scope.phaseData.descriptor) {
                    console.error("Invalid phase data structure provided.");
                    return;
                }
            
                $scope.phaseData.state.responses = $scope.phaseData.state.responses || [];
                $scope.phaseData.descriptor.questions = $scope.phaseData.descriptor.questions || [];
            
                if ($scope.phaseData.state.responses.length === 0 || $scope.phaseData.descriptor.questions.length === 0) {
                    console.warn("No responses or questions available. Initialization skipped.");
                    return;
                }
            
                // Preprocess data using the appropriate strategy for the design type
                const processedData = $scope.preProcessData(
                    $scope.phaseData.state.responses, 
                    $scope.designType
                );
            
                // Update scope with processed data and default sorted responses
                $scope.phaseData.state.responses = processedData;
                $scope.sortedResponses = [...processedData];
            };
            
            // Call initialization when the directive is loaded
            $scope.initialize();
        }
    };
};

export { individualPhaseTableDirective };
