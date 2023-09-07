/*eslint func-style: ["error", "expression"]*/
export let LoginController = ($scope, $http, apiParams) => {
    $scope.init = function () {
        $scope.isTranslationAvailable = false;
        console.log("init");
        $scope.reCaptchaSiteKey = apiParams.reCaptchaSiteKey;
        $scope.getcountries();
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