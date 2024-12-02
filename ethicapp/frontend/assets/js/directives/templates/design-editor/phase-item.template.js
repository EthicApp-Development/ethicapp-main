const phaseItemTemplate = `<div class="panel panel-default">
    <div class="panel-heading">
        <h3 class="panel-title">
            {{ 'stage' | translate }} {{ $ctrl.phase.index + 1 }}
        </h3>
    </div>
    <div class="panel-body">
        <p>
            {{ 'modeType' | translate }}: <strong>{{ $ctrl.phase.mode | translate }}</strong>
        </p>
        <button class="btn btn-info btn-sm" ng-click="$ctrl.onSelect()">
            {{ 'select' | translate }}
        </button>
    </div>
</div>
`;

export default phaseItemTemplate;