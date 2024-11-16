let DesignDescriptionComponent = {
    bindings: {
        design: '<',
        onSelect: '&',     
        pickedDesignId: '<'
    },
    template: `
        <div class="panel panel-default" ng-click="$ctrl.onSelect({ id: $ctrl.design.id })" ng-class="{'dsgn_sel': $ctrl.design.id === $ctrl.pickedDesignId}">
            <div class="panel-body">
                <p><i class="fa-solid fa-info-circle" aria-hidden="true"></i> {{ 'title_colon' | translate }} <a ng-href="#!/designs/{{$ctrl.design.id}}">{{$ctrl.design.metainfo.title}}</a></p>
                <p><i class="fa-solid fa-calendar-alt" aria-hidden="true"></i> {{ 'creation_date_colon' | translate }} {{$ctrl.design.metainfo.creation_date | date}}</p>
                <p><i class="fa-solid fa-paint-brush" aria-hidden="true"></i> {{ 'design_type_colon' | translate }} {{$ctrl.design.type === "semantic_differential" ? ("semantic_differential" | translate) : ("ranking_activity" | translate)}}</p>
                <p><i class="fa-solid fa-layer-group" aria-hidden="true"></i> {{ 'number_of_phases_colon' | translate }} {{$ctrl.design.phases.length}}</p>
            </div>                                    
        </div>
    `
};

export { DesignDescriptionComponent };
