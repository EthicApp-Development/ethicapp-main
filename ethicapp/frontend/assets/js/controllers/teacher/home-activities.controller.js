// The activities on the teacher's home (#1098, epic #1093), below the
// launcher: "Actividades en curso", the five newest activities that are not
// finished, and "Terminadas recientemente", the three newest finished ones,
// in the `activities-table` component of the Activities page. Each section
// has its counts, which link to Actividades, "Mostrando n de m" and "Ver las
// n … →". The row actions and their notice are an ActivityRowActionsService
// instance (#1094), as on the Activities page.
//
// A teacher with no activities sees the `activities-empty-page` component.
// A teacher with activities but none in progress, archived ones included,
// sees one line with "Lanzar actividad" in place of the first table; the
// finished section is left out when there are no finished activities.
//
// The sections are computed once per rebuild, on the catalog's event and on
// a language change, so the tables' `rows` bindings stay the same arrays
// between digests.

import { buildActivityTables } from "../../helpers/activities-table.js";
import { createActivityDateFormatter, uiLanguageOf } from "../../helpers/activity-dates.js";
import { designStepNeeded } from "../../helpers/activities-empty-page.js";
import {
    HOME_FINISHED_ROWS,
    HOME_ONGOING_ROWS,
    homeActivityLinks,
    homeActivitySections,
} from "../../helpers/home-activities.js";

export function HomeActivitiesController($scope, $rootScope, $translate,
    ActivityCatalogService, DesignCatalogService, ActivityRowActionsService) {

    const vm = this;

    vm.loaded = false;
    vm.sections = homeActivitySections({});
    vm.limits = { ongoing: HOME_ONGOING_ROWS, finished: HOME_FINISHED_ROWS };
    vm.links = homeActivityLinks();
    // Whether the empty page shows step 1, "Prepara un diseño"
    // (`designStepNeeded`, as on the Activities page).
    vm.showDesignStep = true;

    // The home is not a tab of Actividades: after archiving, the notice
    // offers "Ver Archivadas", which opens that tab; after "Deshacer" the
    // activity is back in the home's finished section, so no "Ver en
    // Terminadas".
    vm.actions = ActivityRowActionsService.create($scope, {
        currentTab: () => "finished",
    });

    // The sections again from the catalog, with "today" taken now and the
    // dates in the current language.
    vm.refresh = function() {
        const dates = createActivityDateFormatter({ uiLanguage: uiLanguageOf($translate) });
        vm.sections = homeActivitySections(
            buildActivityTables(ActivityCatalogService.getActivities(), dates));
    };

    // The page shows once the activities and, for a teacher with none, the
    // designs are known, so neither the empty page nor its step 1 flickers.
    vm.load = async function() {
        // The catalog answers an empty list when the request fails.
        await ActivityCatalogService.loadActivities();
        vm.refresh();
        if (vm.sections.hasNoActivities) {
            vm.showDesignStep = await designStepNeeded(DesignCatalogService);
        }
        vm.loaded = true;
        $scope.$applyAsync();
    };

    vm.init = function() {
        const rebuild = () => {
            vm.refresh();
            $scope.$applyAsync();
        };
        ActivityCatalogService.registerListener("onActivityCatalogUpdated", rebuild);
        // The run block switches to the profile's language after the profile
        // loads, often after the activities. angular-translate emits the event
        // on $rootScope, so a scope listener would not hear it.
        const stopFollowingLanguage = $rootScope.$on("$translateChangeSuccess", rebuild);
        $scope.$on("$destroy", () => {
            ActivityCatalogService.unregisterListener("onActivityCatalogUpdated", rebuild);
            stopFollowingLanguage();
        });

        return vm.load();
    };

    vm.ready = vm.init();
}
