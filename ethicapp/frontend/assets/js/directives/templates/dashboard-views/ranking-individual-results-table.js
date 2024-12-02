export default rankingIndividualResultsTable = `
    <table class="table table-striped">
        <thead>
            <tr>
                <th>{{ 'participant_column_header' | translate }}</th>
                <th ng-repeat="question in phaseData.descriptor.questions">
                    {{ question.name }}
                </th>
            </tr>
        </thead>
        <tbody>
            <tr ng-repeat="user in phaseData.state.responses track by user.uid">
                <td>{{ user.userName }}</td>
                <td ng-repeat="question in phaseData.descriptor.questions track by question.id">
                    {{ user['r' + $index + 1] || ('no_ranking' | translate) }}
                </td>
            </tr>
        </tbody>
    </table>
    `;
