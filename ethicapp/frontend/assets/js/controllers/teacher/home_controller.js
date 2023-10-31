/*eslint func-style: ["error", "expression"]*/
export let HomeController = ($scope, 
    TabStateService, DesignsService, ActivitiesService,
    $http, $uibModal, $location, $locale, 
    $filter, $socket, $route, $translate) => {
    var self = $scope;
    self.temp = "";
    
    $locale.NUMBER_FORMATS.GROUP_SEP = "";
    self.shared = {};
    self.sessions = [];
    self.selectedView = ""; //current view
    self.activities = []; //activities
    self.currentActivity = {}; //current Activity
    self.design = null;
    self.selectedSes = null;
    self.documents = [];
    self.questions = [];
    self.questionTexts = [];
    self.newUsers = [];
    self.users = {};
    self.selectedId = -1;
    self.role = "A";
    self.sesStatusses = ["notPublicada", "reading", "personal", "anon", "teamWork", "finished"];
    self.optConfidence = [0, 25, 50, 75, 100];
    self.iterationNames = [];
    self.showSeslist = true;
    self.superBar = false;
    self.institution = false;
    self.inst_id = 0;
    self.tabSel = TabStateService.sharedTabState;

    self.init = function () {
        const lang = navigator.language;

        if (lang.startsWith("es")) {
            self.lang = "ES_CL/spanish";
        } else {
            self.lang = "EN_US/english";
        }

        self.shared.getActivities();
        self.updateLang(self.lang);
        
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
        });
    };

    self.changeLang = function (langKey) {
        self.lang = langKey;
        self.updateLang(langKey);
        self.showLanguageDropdown = false;
    };

    self.updateLang = function (langKey) {
        $translate.use(langKey);
    };

    self.getTranslatedLanguageName = function (languageKey) {
        const languageNames = {
            "ES_CL/spanish": $translate.instant("spanish"),
            "EN_US/english": $translate.instant("english")
        };

        return languageNames[languageKey] || languageKey;
    };

    self.shared.getActivities = function() {
        return new Promise(function(resolve, reject) {
            var postdata = {};
            $http({
                url:    "get-activities",
                method: "post",
                data:   postdata
            }).success(function(data) {
                for (var index = 0; index < data.activities.length; index++) {
                    data.activities[index].title = data.activities[index].design.metainfo.title;
                }
                self.activities = data.activities;
                resolve(self.activities);
            }).error(function(error) {
                reject(error);
            });
        });
    };

    /*
    self.typeNames = {
        L: "readComp", 
        S: "multSel", 
        M: "semUnits", 
        E: "ethics", 
        R: "rolePlaying", 
        T: "ethics",
        J: "jigsaw"
    };*/

    self.misc = {};

    self.selectView = function(tab, type){
        if(tab != self.selectedView){
            self.selectedView = tab;
            $route.reload();
            /*
            if (tab != "editDesign" && tab != "viewDesign"){
                // Avoids making designs-documents request
                self.designId.id = null;
            } 
            if (tab != "launchActivity") {
                self.launchId.id = null; 
                self.launchId.title = null; 
                self.launchId.type = null;
            }
            if (tab == "designs") {
                if(type != null) self.tabSel.type = type;
                else self.tabSel.type = 0;
            }*/
        }
    };

    self.init();
};