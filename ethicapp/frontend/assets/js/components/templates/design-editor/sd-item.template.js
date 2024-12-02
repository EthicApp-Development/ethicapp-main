const semanticDifferentialItemTemplate = `<div class="panel panel-primary">
    <div class="panel-heading">
        <h4 class="panel-title">{{ 'semanticDiffEscale' | translate }}</h4>
    </div>
    <div class="panel-body">
        <div class="form-group">
            <label for="questionText">{{ 'questionText' | translate }}</label>
            <input id="questionText" type="text" class="form-control" 
                   placeholder="{{ 'title' | translate }}" 
                   ng-model="$ctrl.question.q_text">
        </div>

        <div class="row">
            <div class="col-xs-3 text-right">
                <input type="text" class="form-control" placeholder="{{ 'left' | translate }}" 
                       ng-model="$ctrl.question.ans_format.l_pole">
            </div>
            <div class="col-xs-6 text-center">
                <span ng-repeat="option in $ctrl.buildOptions($ctrl.question.ans_format.values)" 
                      class="label label-default">
                    {{ option }}
                </span>
            </div>
            <div class="col-xs-3 text-left">
                <input type="text" class="form-control" placeholder="{{ 'right' | translate }}" 
                       ng-model="$ctrl.question.ans_format.r_pole">
            </div>
        </div>
    </div>
</div>
`;

export default semanticDifferentialItemTemplate;