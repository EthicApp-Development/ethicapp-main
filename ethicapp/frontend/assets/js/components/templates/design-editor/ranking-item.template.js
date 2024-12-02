const rankingItemTemplate = `<div class="panel panel-info">
    <div class="panel-heading">
        <h4 class="panel-title">{{ 'roles' | translate }}</h4>
    </div>
    <div class="panel-body">
        <textarea class="form-control" rows="2" 
                  placeholder="{{ 'question' | translate }}" 
                  ng-model="$ctrl.phase.q_text"></textarea>

        <ul class="list-group">
            <li class="list-group-item" ng-repeat="role in $ctrl.phase.roles">
                <div class="input-group">
                    <input type="text" class="form-control" 
                           placeholder="{{ 'roleName' | translate }}" 
                           ng-model="role.name">
                    <span class="input-group-btn">
                        <button class="btn btn-danger" ng-click="$ctrl.removeRole($index)">
                            <i class="glyphicon glyphicon-trash"></i>
                        </button>
                    </span>
                </div>
            </li>
        </ul>

        <button class="btn btn-success" ng-click="$ctrl.addRole()">
            <i class="glyphicon glyphicon-plus"></i> {{ 'addRole' | translate }}
        </button>
    </div>
</div>`;