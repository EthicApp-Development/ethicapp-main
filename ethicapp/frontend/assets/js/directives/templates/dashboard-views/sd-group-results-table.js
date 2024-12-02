export default sdGroupResultsTable = `
    <table class="table table-striped">
        <thead>
            <tr>
                <th>{{ 'author_column_header' | translate }}</th>
                <th>{{ 'group_column_header' | translate }}</th>
                <th ng-repeat="question in phaseData.descriptor.questions">
                    {{ 'item_label' | translate }} {{ $index + 1 }} (1-{{ question.range }})
                    <span ng-if="question.justify" class="text-danger">*</span>
                </th>
                <th>{{ 'chat_column_header' | translate }}</th>
            </tr>
        </thead>
        <tbody>
            <tr ng-repeat="user in phaseData.state.data track by $index" ng-class="{'group-summary': user.groupStatistics}">
                <td>
                    <span ng-if="!user.groupStatistics">{{ user.userName }}</span>
                    <strong ng-if="user.groupStatistics">{{ user.groupName }}</strong>
                </td>

                <td>{{ user.groupStatistics ? user.groupNumber : user.groupNumber || '-' }}</td>

                <td ng-repeat="question in phaseData.descriptor.questions">
                    <div ng-if="!user.groupStatistics">
                        {{ user['r' + ($index + 1)] || ('no_response' | translate) }}
                        <span class="badge badge-info">
                            <i class="fa fa-comments"></i> {{ user['chatR' + ($index + 1)] || 0 }}
                        </span>
                        <i ng-if="user['commentR' + ($index + 1)] && user['commentR' + ($index + 1)].length > 0"
                        class="fa-solid fa-note-sticky text-warning"
                        aria-hidden="true"
                        title="{{ 'comment_exists_tooltip' | translate }}"></i>
                    </div>
                    <div ng-if="user.groupStatistics">
                        <span>
                            A: {{ user['averageR' + ($index + 1)] || '-' }}
                        </span>
                        <span class="badge badge-success">
                            CV: {{ user['cvR' + ($index + 1)] || '-' }}
                        </span>
                        <span class="badge badge-danger">
                            <i class="fa fa-comments"></i> {{ user['chatR' + ($index + 1)] || 0 }}
                        </span>
                    </div>
                </td>

                <td>
                    <span ng-if="!user.groupStatistics">
                        <span class="badge badge-danger">
                            <i class="fa fa-comments"></i> {{ user.totalChatCount || 0 }}
                        </span>
                    </span>
                    <span ng-if="user.groupStatistics">
                        <strong>Total:</strong>
                        <span class="badge badge-danger">
                            <i class="fa fa-comments"></i> {{ user.totalChatCount || 0 }}
                        </span>
                    </span>
                </td>
            </tr>
        </tbody>
        <tfoot>
            <tr>
                <td colspan="{{ phaseData.descriptor.questions.length + 2 }}">
                    <div class="summary-text">
                        <strong>{{ 'participants_label' | translate }}:</strong> 
                        {{ phaseData.state.data.filter(user => !user.groupStatistics).length }} <br>
                        <strong>A:</strong> {{ 'average_label' | translate }}. 
                        <strong>CV:</strong> {{ 'coefficient_of_variation_label' | translate }}. 
                        <i class="fa fa-comments"></i> {{ 'chat_messages_label' | translate }}.
                    </div>
                </td>
            </tr>
        </tfoot>        
    </table>`;