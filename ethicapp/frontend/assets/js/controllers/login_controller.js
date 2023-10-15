/*eslint func-style: ["error", "expression"]*/
export let LoginController = ($scope, $http, $translate) => {
    var self = $scope;
    const lang = navigator.language;

    if (lang.startsWith('es')) {
        self.lang = 'ES_CL/spanish';
    } else {
        self.lang = 'EN_US/english';
    }

    self.updateLang = function (langKey) {
        $translate.use(langKey);
    };

    self.changeLang = function () {
        self.lang = self.lang == "EN_US/english" ? "ES_CL/spanish" : "EN_US/english";
        self.updateLang(self.lang);
    };

    self.init = function () {
        self.updateLang(self.lang);
        self.getcountries();
    };

    $scope.getcountries = function(){
        $http.get("https://restcountries.com/v3.1/all").success(function (data) {
            var list = [];
            
            for(var i = 0;i< data.length;i++){ 
                list.push(data[i].name.common);
            }
            list.sort();
            if($scope.lang == "ES_CL/spanish"){
                list.unshift("Elige un Pais");
            }
            else{
                list.unshift("Choose Country");
            }
            $scope.countries = list;
        });
    };   

    $scope.init();
};