export let LocalesController = ($translate, $scope, $rootScope) => {
    var self = $scope;

    // Share state among the rootScope and the local scope
    $scope.translationsLoaded = $rootScope.translationsLoaded;

    // Listen to translation events in the rootScope
    $rootScope.$on("$translateChangeEnd", function () {
        $scope.translationsLoaded = true;
        $scope.$applyAsync(); // Ensure the DOM is updated
    });

    // Get the current language
    $scope.currentLanguage = $translate.use();

    // Change language manually if needed
    self.changeLanguage = function (langKey) {
        $translate.use(langKey);
        $scope.currentLanguage = langKey;
    };
};