const semanticDifferentialItemTemplate = `
<div class="panel">
    <div class="panel-body">
        <div class="form-group">
            <label for="questionText">{{ 'questionText' | translate }}</label>
            <input id="questionText" type="text" class="form-control" 
                   placeholder="{{ 'title' | translate }}" 
                   ng-model="$ctrl.question.q_text"
                   ng-change="$ctrl.validateItem()">
        </div>

        <div class="row dashed-bottom-border">
            <div class="col-xs-3 text-right">
                <input type="text" class="form-control" placeholder="{{ 'left' | translate }}" 
                       ng-model="$ctrl.question.ans_format.l_pole" ng-blur="$ctrl.validateItem()">
            </div>
            <div class="col-xs-6 text-center">
                <button class="btn btn-default btn-sm" ng-click="$ctrl.removeScaleTick()">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <i style="margin-left:1em" class="fa-regular fa-circle" ng-repeat="option in $ctrl.buildOptions($ctrl.question.ans_format.values)"></i>
                <button style="margin-left:1em" class="btn btn-default btn-sm" ng-click="$ctrl.addScaleTick()">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <br>
                <small>{{ 'scale_values_text' | translate }}: 1-{{$ctrl.question.ans_format.values}}</small>
            </div>
            <div class="col-xs-3 text-left">
                <input type="text" class="form-control" placeholder="{{ 'right' | translate }}" 
                       ng-model="$ctrl.question.ans_format.r_pole"
                       ng-change="$ctrl.validateItem()">
            </div>
        </div>
        <hr>
        <div class="row">
            <div class="col-xs-12">
                <div class="btn-group" role="group" aria-label="Item Actions">
                    <ng-transclude></ng-transclude>
                </div>
            </div>
        </div>
    </div>
</div>
<hr>
`;

export default semanticDifferentialItemTemplate;