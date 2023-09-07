/*eslint func-style: ["error", "expression"]*/
export let LoginController = ($scope, $http, apiParams) => {
    var self = $scope;
    self.reCaptchaSiteKey = apiParams.reCaptchaSiteKey;

    const lang = navigator.language;
    if(lang[0] == "e" && lang[1] == "s"){
        self.lang = "ES_CL/spanish";
    }
    else{
        self.lang = "EN_US/english";
    }

    window.DIC = "assets/i18n/" + self.lang + ".json";

    self.init = function () {
        self.updateLang(self.lang);
        self.getcountries();
    };

    self.activate_user = function(){
        var url_string = window.location;
        var url = new URL(url_string);
        var token = url.searchParams.get("tok");
        //console.log(token);
        $http({ url: "activate_user", method: "post",data: {token} }).success(function () {
        });
    };

    self.getcountries = function(){
        $http.get("https://restcountries.com/v3.1/all").success(function (data) {
            var list = [];
            
            for(var i = 0;i< data.length;i++){ 
                list.push(data[i].name.common);
            }
            list.sort();
            if(lang[0] == "e" && lang[1] == "s"){
                list.unshift("Elige un Pais");
            }
            else{
                list.unshift("Choose Country");
            }
            self.countries = list;
        });
    };

    self.updateLang = function (lang) {
        $http.get("assets/i18n/" + lang + ".json").
            success(function (data) {
                window.DIC = data;
            });
    };

    self.changeLang = function () {
        self.lang = self.lang == "EN_US/english" ? "ES_CL/spanish" : "EN_US/english";
        self.updateLang(self.lang);
    };

    self.init();
};