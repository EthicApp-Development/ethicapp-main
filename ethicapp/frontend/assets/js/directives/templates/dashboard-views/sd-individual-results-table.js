export default sdIndividualResultsTable = `
    <table class="table table-striped">
        <thead>
            <tr>
                <th>{{ 'participant_column_header' | translate }}</th>
                <th ng-repeat="question in phaseData.descriptor.questions">
                    {{ 'item_label' | translate }} {{ $index + 1 }} (1-{{ question.range }})
                    <span ng-if="question.justify" class="text-danger">*</span>
                </th>
            </tr>
        </thead>
        <tbody>
            <tr ng-repeat="response in phaseData.state.responses track by response.userId">
                <td>{{ response.userName }}</td>
                <td ng-repeat="question in phaseData.descriptor.questions">
                    {{ response['r' + question.number] || ('no_response' | translate) }}
                    <!-- Checkmark con FontAwesome -->
                    <i ng-if="response['commentR' + question.number] && response['commentR' + question.number].length > 0"
                    class="fas fa-sticky-note"
                    aria-hidden="true"></i>
                </td>
            </tr>
        </tbody>
        <tfoot>
            <tr>
                <td colspan="{{ phaseData.descriptor.questions.length + 1 }}">
                    <div class="summary-text">
                        <strong>{{ 'participants_label' | translate }}:</strong> {{ phaseData.state.responses.length }} <br>
                        <strong>A:</strong> {{ 'average_label' | translate }}. <strong>CV:</strong> {{ 'coefficient_of_variation_label' | translate }}. <i class="fa fa-comments"></i> {{ 'chat_messages_label' | translate }}. <span class="class="text-danger">*</span> {'justification_required_caption' | translate }.
                    </div>
                </td>
            </tr>
        </tfoot>
    </table>`;
