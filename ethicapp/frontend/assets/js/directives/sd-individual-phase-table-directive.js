let sdIndividualPhaseTableDirective = function() {
    return {
        restrict: 'E',
        scope: {
            questions: '<',
            responses: '<'
        },
        // TODO: refactoring, so that the template is imported depending on the
        // type of activity
        template: `
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>{{ 'participant_column_header' | translate }}</th>
                        <th ng-repeat="question in questions">{{ question.text }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr ng-repeat="response in responses">
                        <td>{{ responses.name }}</td>
                        <td ng-repeat="question in questions">
                            {{ responses[user.id][question.id] || ('no_response' | translate) }}
                        </td>
                    </tr>
                </tbody>
            </table>
        `
    };
};

export { sdIndividualPhaseTableDirective };