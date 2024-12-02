export default sdGroupResultsTable = `
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
        `;