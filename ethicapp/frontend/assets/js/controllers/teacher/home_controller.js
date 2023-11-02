/*eslint func-style: ["error", "expression"]*/
export let HomeController = ($scope, 
    TabStateService, DesignsService, ActivitiesService,
    $http, $uibModal, $location, $locale, 
    $filter, $socket, $route, $translate) => {
    
    var self = $scope;
    self.shared = {};
    // [DEPRECATED] self.misc = {};
    // [DEPRECATED] self.temp = "";
    // [DEPRECATED] self.sessions = [];    
    // [DEPRECATED] self.currentActivity = {}; //current Activity
    // [DEPRECATED] self.design = null;
    // [DEPRECATED] self.selectedSes = null;
    // [DEPRECATED] self.documents = [];
    // [DEPRECATED] self.questions = [];
    // [DEPRECATED] self.questionTexts = [];
    // [DEPRECATED] self.newUsers = [];
    // [DEPRECATED] self.users = {};
    // [DEPRECATED] self.selectedId = -1;
    // [DEPRECATED] self.role = "A";
    // [DEPRECATED] self.sesStatusses = ["notPublicada", "reading", "personal", "anon", "teamWork", "finished"];
    // [DEPRECATED] self.optConfidence = [0, 25, 50, 75, 100];
    // [DEPRECATED] self.iterationNames = [];
    // [DEPRECATED] self.showSeslist = true;
    // [DEPRECATED] self.superBar = false;
    // [DEPRECATED] self.institution = false;
    // [DEPRECATED] self.inst_id = 0;

    self.init = function () {
        self.tabSel = TabStateService.sharedTabState;
        self.selectedView = ""; //current view
        self.activities = [];   //activities
    
        const lang = navigator.language;
        
        if (lang.startsWith("es")) {
            self.lang = "ES_CL/spanish";
        } else {
            self.lang = "EN_US/english";
        }

        self.initActivitiesList();
        self.updateLang(self.lang);
        
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
        });
    };

    self.initActivitiesList = () => {
        self.activities = ActivitiesService.activities;
        $scope.$on("ActivitiesService_activitiesUpdated", (event, data) => {
            self.activities = data;
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