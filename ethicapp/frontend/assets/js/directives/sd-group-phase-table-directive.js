let sdGroupPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            questions: '<',
            responses: '<'
        },
        // TODO: Refactoring, so that the appropriate template is chosen depending on the
        // type of activity
        template: `
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>{{ 'group' | translate }}</th>
                        <th>{{ 'members' | translate }}</th>
                        <th ng-repeat="question in questions">{{ question.text }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr ng-repeat="group in phaseDesign.groups">
                        <td>{{ group.id }}</td>
                        <td>
                            <ul>
                                <li ng-repeat="userId in group.members">
                                    {{ getUserName(userId) }}
                                </li>
                            </ul>
                        </td>
                        <td ng-repeat="question in phaseConfig.questions">
                            <!-- Mostrar respuestas agregadas o por grupo -->
                            <span ng-repeat="response in getGroupResponses(group.members, question.id)">
                                {{ response }}<br>
                            </span>
                        </td>
                    </tr>
                </tbody>
            </table>
        `,
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

export { sdGroupPhaseTableDirective };