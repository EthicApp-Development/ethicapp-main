const rankingItemsEditorTemplate = 
`<div class="panel panel-info dashed-bottom-border">
    <div class="panel-body">
        <ul class="list-group">
            <li class="list-group-item" ng-repeat="item in $ctrl.items">
                <div class="input-group">
                    <input type="text" class="form-control" 
                           placeholder="{{ 'roleName' | translate }}" 
                           ng-model="item.name">
                    <span class="input-group-btn">
                        <button class="btn btn-danger" ng-click="$ctrl.removeRole(item)">                    
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

export default rankingItemsEditorTemplate;