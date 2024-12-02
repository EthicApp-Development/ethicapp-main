const sdPhaseDescriptionTemplate = `
    <div>
    <h3>{{ 'phase_mode_label' | translate }}: {{ $ctrl.phaseMode | translate }}</h3>
    <div ng-if="$ctrl.phaseMode === 'team'">
        <p>
            <strong>{{ 'interaction_type_label' | translate }}:</strong>
            {{ $ctrl.phaseDetails.anonymous ? ('anonymous_label' | translate) : ('identified_label' | translate) }}
        </p>
        <p>
            <strong>{{ 'chat_enabled_label' | translate }}:</strong>
            {{ $ctrl.phaseDetails.chat ? ('yes_label' | translate) : ('no_label' | translate) }}
        </p>
        <p>
            <strong>{{ 'grouping_algorithm_label' | translate }}:</strong> {{ $ctrl.phaseDetails.grouping_algorithm | translate }}
        </p>
        <p>
            <strong>{{ 'group_size_label' | translate }}:</strong> {{ $ctrl.phaseDetails.stdntAmount }}
        </p>
        <p ng-if="$ctrl.phaseDetails.prevPhasesResponse.length > 0">
            <strong>{{ 'previous_phases_label' | translate }}:</strong>
            {{ $ctrl.phaseDetails.prevPhasesResponse.join(', ') }}
        </p>
    </div>

    <h4>{{ 'questions_label' | translate }}</h4>
    <table class="table table-striped">
        <thead>
            <tr>
                <th>{{ 'question_text_label' | translate }}</th>
                <th>{{ 'left_pole_label' | translate }}</th>
                <th>{{ 'right_pole_label' | translate }}</th>
                <th>{{ 'range_label' | translate }}</th>
                <th>{{ 'justification_required_label' | translate }}</th>
                <th>{{ 'min_words_label' | translate }}</th>
            </tr>
        </thead>
        <tbody>
            <tr ng-repeat="question in $ctrl.phaseQuestions">
                <td>{{ question.text }}</td>
                <td>{{ question.leftPole }}</td>
                <td>{{ question.rightPole }}</td>
                <td>{{ question.range }}</td>
                <td>{{ question.justificationRequired ? ('yes_label' | translate) : ('no_label' | translate) }}</td>
                <td>{{ question.minJustificationLength }}</td>
            </tr>
        </tbody>
    </table>
</div>`;

export default sdPhaseDescriptionTemplate;