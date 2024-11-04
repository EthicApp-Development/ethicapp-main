/*eslint func-style: ["error", "expression"]*/
export let ManagementController = ($scope, 
    TabStateService, DesignStateService, ActivityStateService,
    $http, $uibModal, $location, $locale, 
    $filter, $socket, $route, $translate) => {
    var self = $scope;
    self.temp = "";
    const lang = navigator.language;
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
    self.designId = DesignStateService.designState;
    self.launchId = ActivityStateService.activityState;

    if (lang.startsWith('es')) {
        self.lang = 'es_CL';
    } else {
        self.lang = 'en_US';
    }

    self.showLanguageDropdown = false;

    self.toggleLanguageDropdown = function () {
        self.showLanguageDropdown = !self.showLanguageDropdown;
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
            'es_CL': $translate.instant('spanish'),
            'en_US': $translate.instant('english')
        };

        return languageNames[languageKey] || languageKey;
    };

    
    self.secIcons = {
        configuration: "cog",
        editor:        "edit",
        dashboard:     "bar-chart",
        users:         "male",
        rubrica:       "check-square",
        groups:        "users",
        options:       "sliders"
    };
    self.typeNames = {
        L: "readComp", S: "multSel", M: "semUnits", E: "ethics", R: "rolePlaying", T: "ethics",
        J: "jigsaw"
    };

    self.misc = {};

    self.init = function () {
        console.log("[ManagementController] init.");
        //self.updatelangdata();
        self.getMe();
        
        self.shared.updateSesData();
        self.shared.getActivities();
        self.updateLang(self.lang);
        
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            //if (data.ses == self.selectedSes.id) {
            //window.location.reload(); <--------
            //}
        });
    };

    self.updatelangdata = async function () {
        try {
            const response = await $http({
                url: "updatelangdata",
                method: "post",
                data: { lang }
            });
            console.log(response.data);
        } catch (error) {
            console.error("Error updating language data:", error);
        }
    };
    
    self.set_id = function(id) {
        self.inst_id = id;
    };
    self.reset_inst_id = function() {
        self.inst_id = 0;
        self.selectView("institution_admin");
    };

    self.getMe = function(){
        /*
        $http.get("is-super").success(data => {
            if(data.status == "ok"){
                self.superBar = true;
                self.super = true;
            }
        });
        $http.get("is-institution").success(data => {
            self.institution = data.status;
        });*/
    };

    self.selectSession = function (ses, id) {
        self.selectedId = id;
        self.selectedSes = ses;
        self.requestDocuments();
        self.requestSemDocuments();
        self.requestQuestions();
        self.getNewUsers();
        self.getMembers();
        self.shared.verifyGroups();
        self.shared.resetGraphs();
        self.shared.verifyTabs();
        self.shared.resetTab();
        self.shared.updateConf();
        $location.path(self.selectedSes.id);
        if(self.shared.getStages)
            self.shared.getStages();
    };


    //Select activity from Activities
    self.selectActivity = function(activityId, sesId, design){
        self.selectView("activity");
        self.currentActivity.id = activityId;
        self.selectedId = sesId;
        self.selectedSes = getSession(sesId)[0];
        console.log(self.selectedSes);
        self.design = design;
        console.log("Activity ID:",self.currentActivity);
        console.log("Session ID:",self.selectedId);
        console.log("Design:",self.design); 
        //------------------------
        self.requestDocuments();
        //self.shared.updateState();
        self.requestSemDocuments();
        self.requestQuestions();
        self.getNewUsers();
        self.getMembers();
        //self.shared.verifyGroups(); //GroupController
        self.shared.verifyTabs(); //TabsController
        self.shared.resetTab(); //TabsController
        //self.shared.updateConf(); //OptionsController
        //$location.path(self.selectedSes.id);
        if(self.shared.getStages)
            self.shared.getStages();
        
    };

    function getSession(id) {
        return self.sessions.filter(
            function(sessions){ return sessions.id == id; }
        );
    }

    self.selectView = function(tab, type){
        if(tab != self.selectedView){
            self.selectedView = tab;
            console.log(self.selectedView);
            $route.reload();
            if (tab != "newDesignExt" && tab != "viewDesign"){
                self.designId.id = null; //avoids making designs-documents request
            } 
            if (tab != "launchActivity") {
                self.launchId.id = null; 
                self.launchId.title = null; 
                self.launchId.type = null;
            }
            if (tab == "designs") {
                if(type != null) self.tabSel.type = type;
                else self.tabSel.type = 0;
            }
            console.log(self.selectedView);
        }
    };

    self.shared.updateSesData = function () {
        $http({ url: "get-session-list", method: "post" }).success(function (data) {
            console.log("Session data updated");
            self.sessions = data;
            if (self.selectedId != -1) {
                var ses = self.sessions.find(function (e) {
                    return e.id == self.selectedId;
                });
                if (ses != null) self.selectSession(ses, self.selectedId);
            } else {
                self.sesFromURL();
            }
        });
    };

    self.changeDesign = function(selectedDesign){
        self.design = selectedDesign;
    };

    self.shared.getActivities = async function () {
        const postdata = {};
    
        try {
            const response = await $http({
                url: "get-activities",
                method: "post",
                data: postdata
            });
            
            // Map titles from design metadata
            response.data.activities.forEach(activity => {
                activity.title = activity.design.metainfo.title;
            });
    
            self.activities = response.data.activities;
            return self.activities;
    
        } catch (error) {
            console.error("Error fetching activities:", error);
            throw error;
        }
    };
    
    self.sesFromURL = function () {
        var sesid = +$location.path().substring(1);
        var ses = self.sessions.find(function (e) {
            return e.id == sesid;
        });
        if (ses != null) self.selectSession(ses, sesid);
    };

    self.requestDocuments = async function () {
        const postdata = { sesid: self.selectedSes.id };
    
        try {
            const response = await $http({
                url: "documents-session",
                method: "post",
                data: postdata
            });
            self.documents = response.data;
        } catch (error) {
            console.error("Error fetching documents:", error);
        }
    };
    

    self.shared.updateDocuments = self.requestDocuments;

    self.deleteDocument = async function (docid) {
        const postdata = { docid: docid };
    
        try {
            await $http({
                url: "delete-document",
                method: "post",
                data: postdata
            });
            
            // Refresh documents list after deletion
            await self.requestDocuments();
        } catch (error) {
            console.error("Error deleting document:", error);
        }
    };
    
    self.requestQuestions = async function () {
        const postdata = { sesid: self.selectedSes.id };
    
        try {
            // Step 1: Fetch questions for the session
            const questionsResponse = await $http({
                url: "questions-session",
                method: "post",
                data: postdata
            });
            
            self.questions = questionsResponse.data.map(e => {
                e.options = e.options.split("\n");
                return e;
            });
    
            // Step 2: Fetch question texts for the session
            const textsResponse = await $http({
                url: "get-question-text",
                method: "post",
                data: postdata
            });
    
            self.questionTexts = textsResponse.data;
    
        } catch (error) {
            console.error("Error fetching questions and question texts:", error);
        }
    };
    
    self.requestSemDocuments = async function () {
        const postdata = { sesid: self.selectedSes.id };
    
        try {
            const response = await $http({
                url: "semantic-documents",
                method: "post",
                data: postdata
            });
            self.semDocs = response.data;
        } catch (error) {
            console.error("Error fetching semantic documents:", error);
        }
    };
    
    self.getNewUsers = async function () {
        const postdata = { sesid: self.selectedSes.id };
    
        try {
            const response = await $http({
                url: "get-new-users",
                method: "post",
                data: postdata
            });
            self.newUsers = response.data;
        } catch (error) {
            console.error("Error fetching new users:", error);
        }
    };
    
    self.getMembers = async function () {
        const postdata = { sesid: self.selectedSes.id };
    
        try {
            const response = await $http({
                url: "get-ses-users",
                method: "post",
                data: postdata
            });
    
            self.usersArr = response.data;
            self.users = {};
            response.data.forEach(d => {
                self.users[d.id] = d;
            });
        } catch (error) {
            console.error("Error fetching session members:", error);
        }
    };
    
    self.openNewSes = function () {
        $uibModal.open({
            templateUrl: "static/new-ses.html"
        });
    };

    self.openViewSelected = function () { //Displays View Selected
        if(self.selectedView == "TEST"){
            $uibModal.open({
                templateUrl: "static/home.html"
            });

        }
    };

    self.openDuplicateSes = function () {
        if (self.selectedSes == null) return;
        var ses = angular.copy(self.selectedSes);
        $uibModal.open({
            templateUrl:  "static/duplicate-ses.html",
            controller:   "DuplicateSesModalController",
            controllerAs: "vm",
            scope:        self,
            resolve:      {
                data: function data() {
                    return ses;
                }
            }
        });
    };

    self.openDuplicateSesSpec = function (sesr, $event) {
        $event.stopPropagation();
        var ses = angular.copy(sesr);
        $uibModal.open({
            templateUrl:  "static/duplicate-ses.html",
            controller:   "DuplicateSesModalController",
            controllerAs: "vm",
            scope:        self,
            resolve:      {
                data: function data() {
                    return ses;
                }
            }
        });
    };

    self.toggleSidebar = function () {
        self.openSidebar = !self.openSidebar;
        self.shared.updateState();
    };

    

    self.shared.resetSesId = function () {
        self.selectedId = -1;
    };


    self.generateCode = async function () {
        const postdata = { id: self.selectedSes.id };
    
        try {
            const response = await $http.post("generate-session-code", postdata);
            if (response.data.code != null) {
                self.selectedSes.code = response.data.code;
            }
        } catch (error) {
            console.error("Error generating session code:", error);
        }
    };
    

    self.flang = function (key) {
        return $filter("translate")(key);
    };

    self.init();
};