let activityDescriptionComponent = {
    bindings: {
        activity: '<',
        enableLink: '<'
   },
    template: `
        <div class="panel panel-default">
            <div class="panel-heading" ng-if="$ctrl.activity.name">{{$ctrl.activity.name}}</div>
            <div class="panel-body">
                <p><b><i class="fa-solid fa-asterisk"></i> {{ 'activity_description_colon' | translate }}</b><a ng-href="#!/activities/{{$ctrl.activity.activityId}}" ng-if="$ctrl.enableLink">{{ $ctrl.activity.description === '' ? ('no_description' | translate) : $ctrl.activity.description }}</a><span ng-if="!$ctrl.enableLink">{{ $ctrl.activity.description === '' ? ('no_description' | translate) : $ctrl.activity.description }}</span></p>
                <p><b><i class="fa-solid fa-paint-brush" aria-hidden="true"></i> {{ 'design_used_colon' | translate }}</b><a ng-href="#!/designs/{{$ctrl.activity.designId}}" ng-if="$ctrl.enableLink">{{ $ctrl.activity.design.metainfo.title }}</a><span ng-if="!$ctrl.enableLink">{{ $ctrl.activity.design.metainfo.title }}</span><span class="small">({{$ctrl.activity.type === "R" ? ('ranking_activity' | translate) : ('semantic_differential' | translate)}})</span></p>
                <p><b><i class="fa-solid fa-key" aria-hidden="true"></i> {{ 'access_code_colon' | translate }}</b> {{ $ctrl.activity.code }}</p>
                <p><b><i class="fa-solid fa-calendar-alt" aria-hidden="true"></i> {{ 'launch_date_colon' | translate }}</b> {{ $ctrl.activity.time | date:'dd-MM-yyyy HH:mm' }} (UTC)</p>
            </div>
        </div>
    `,
    controller: function() {
        this.$onInit = function() {
            if (angular.isUndefined(this.enableLink)) {
                this.enableLink = true;
            }
        };
    }
};

export { activityDescriptionComponent };
