export default sdIndividualResultsTable = `
    <table class="table table-striped">
        <thead>
            <tr>
                <th>{{ 'participant_column_header' | translate }}</th>
                <th ng-repeat="question in phaseData.descriptor.questions">
                    {{ 'sd_question_header_letter' | translate }}{{ question.number }}
                </th>
            </tr>
        </thead>
        <tbody>
            <tr ng-repeat="response in phaseData.state.responses track by response.userId">
                <td>{{ response.userName }}</td>
                <td ng-repeat="question in phaseData.descriptor.questions">
                    {{ response['r' + question.number] || ('no_response' | translate) }}
                </td>
            </tr>
        </tbody>
    </table>
    `;
