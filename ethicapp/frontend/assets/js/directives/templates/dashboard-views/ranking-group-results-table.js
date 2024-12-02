export default rankingGroupResultsTable = `
    <table class="table table-striped table-sortable">
        <thead>
            <tr>
                <th>{{ 'number_of_equal_column_header' | translate }}</th>
                <th>{{ 'author_column_header' | translate }}</th>
                <th>{{ 'group_column_header' | translate }}</th>
                <th ng-repeat="question in phaseData.descriptor.questions">
                    {{ 'position_label' | translate }} {{ $index + 1 }}
                </th>
            </tr>
        </thead>
        <tbody>
            <tr ng-repeat="response in sortedResponses track by response.uid">
                <td>{{ response.clusterCount }}</td>
                <td>
                    {{ response.userName }}
                    <span class="badge badge-danger">
                        <i class="fa fa-comments"></i> {{ response.totalChatCount || 0 }}
                    </span>
                </td>
                <td>
                    {{ response.groupNumber || '-' }}
                    <span class="badge badge-primary">
                        <i class="fa fa-comments"></i> {{ response.groupChatMessages || 0 }}
                    </span>
                </td>
                <td ng-repeat="question in phaseData.descriptor.questions">
                    <span>
                        {{ response['r' + ($index + 1)] || ('no_response' | translate) }}
                    </span>
                </td>
            </tr>
        </tbody>
    </table>
`;
