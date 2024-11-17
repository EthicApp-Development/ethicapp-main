export function LocalesController($translate, $scope, $rootScope) {
    const vm = this;

    vm.init = function () {
        // Initial state to check if translations have been loaded
        $scope.translationsLoaded = false;

        // State to show/hide the language dropdown menu
        $scope.showLanguageDropdown = false;

        // Ensure $translate.use() returns a valid string
        const currentLanguage = $translate.use() || "en_US";

        // Initialize the language based on the current translation settings
        if (currentLanguage.startsWith("es")) {
            $scope.lang = "es_CL";
        } else {
            $scope.lang = "en_US";
        }

        // Current language to be displayed in the UI
        $scope.currentLanguage = $scope.lang;
    };

    // Change the language and update the configuration
    $scope.changeLanguage = function (langKey) {
        $scope.lang = langKey;
        $scope.updateLanguage(langKey);
        $scope.showLanguageDropdown = false;
    };

    // Update the language using $translate
    $scope.updateLanguage = function (langKey) {
        $translate.use(langKey);
    };

    // Get the translated name of a language
    $scope.getTranslatedLanguageName = function (languageKey) {
        const languageNames = {
            "es_CL": $translate.instant("spanish"),
            "en_US": $translate.instant("english")
        };
        return languageNames[languageKey] || languageKey;
    };

    // Listen to translation change events and update the state
    $rootScope.$on("$translateChangeEnd", function () {
        $scope.translationsLoaded = true;
        $scope.currentLanguage = $translate.use(); // Update the current language
        $scope.$applyAsync(); // Ensure the DOM reflects the changes
    });

    vm.init();
}
