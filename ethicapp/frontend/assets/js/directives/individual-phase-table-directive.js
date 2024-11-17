let individualPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            phaseConfig: '<',
            users: '<',
            responses: '<'
        },
        // TODO: refactoring, so that the template is imported depending on the
        // type of activity
        template: `
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>{{ 'participant_column_header' | translate }}</th>
                        <th ng-repeat="question in phaseConfig.questions">{{ question.text }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr ng-repeat="user in users">
                        <td>{{ user.name }}</td>
                        <td ng-repeat="question in phaseConfig.questions">
                            {{ responses[user.id][question.id] || ('no_response' | translate) }}
                        </td>
                    </tr>
                </tbody>
            </table>
        `
    };
};

export { individualPhaseTableDirective };