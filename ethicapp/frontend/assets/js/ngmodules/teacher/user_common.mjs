import { MatchFieldDirective } from "../../directives/match-field.directive.js";
import { InstitutionRequired } from "../../directives/institution-required.directive.js";

var ngapp_user_common = angular.module("UserCommon", [
    "api-params", "ui.bootstrap", "ui-notification",
    "pascalprecht.translate", "ngRoute"]);

ngapp_user_common.config(function($compileProvider) {
    $compileProvider.debugInfoEnabled(true);
});

// Translations
ngapp_user_common.config(function($translateProvider) {
    $translateProvider.useSanitizeValueStrategy('sanitizeParameters');

    $translateProvider.useStaticFilesLoader({
        prefix: 'assets/i18n/', 
        suffix: '.json'
    });

    // Set default language
    $translateProvider.preferredLanguage('es');
});

ngapp_user_common.directive('matchField', MatchFieldDirective);
ngapp_user_common.directive('institutionRequired', InstitutionRequired);

import { LoginController } from "../../controllers/login_controller.js";
import { RegisterController } from "../../controllers/register_controller.js";

ngapp_user_common.controller("LoginController", ['$scope', '$http', '$translate', LoginController]);
ngapp_user_common.controller("RegisterController", 
    ['$scope', '$http', '$translate', 'apiParams', RegisterController]);

