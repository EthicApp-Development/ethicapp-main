"use strict";

var adpp = angular.module("Admin", ["ui.bootstrap", "ui.multiselect", "nvd3", "timer", "ui-notification", "ngQuill",
    "ngMap", "tableSort", 'btford.socket-io', 'ngRoute']); //ngRoute was newly added

var DASHBOARD_AUTOREALOD = window.location.hostname.indexOf("fen") != -1;
var DASHBOARD_AUTOREALOD_TIME = 15;

var designId = {id:null}
var launchId = {id:null}
var prevTab = "";

window.DIC = null;
window.warnDIC = {};

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

//Rich text editor
adpp.config(['ngQuillConfigProvider', function (ngQuillConfigProvider) {
    ngQuillConfigProvider.set({
        modules: {
            formula: true,
            toolbar: {
                container: [['bold', 'italic', 'underline', 'strike'], // toggled buttons

                [{ 'color': [] }, { 'background': [] }], // dropdown with defaults from theme
                [{ 'font': [] }], [{ 'align': [] }],

                //[{ 'header': 1 }, { 'header': 2 }],               // custom button values
                [{ 'list': 'ordered' }, { 'list': 'bullet' }], [{ 'script': 'sub' }, { 'script': 'super' }], // superscript/subscript

                //[{ 'indent': '-1'}, { 'indent': '+1' }],          // outdent/indent
                //[{ 'direction': 'rtl' }],                         // text direction

                //['blockquote', 'code-block'],
                [{ 'size': ['small', false, 'large', 'huge'] }], // custom dropdown
                //[{ 'header': [1, 2, 3, 4, 5, 6, false] }],

                ['clean'], // remove formatting button
                ['image', 'link', 'video'], // remove formatting button
                ['formula']
                ]
            }
        }
    });
}]);

//ROUTING

adpp.config(function ($routeProvider, $locationProvider) {
    $routeProvider
    // set route for the index page
    .when('/',
    {
        controller: 'RouteCtrl',
        templateUrl: '/templ/admin/uirouter.html'
    })

 
});
 
adpp.controller('RouteCtrl', function($scope) {
    $scope.template={      
      "home":"/templ/admin/home.html",
      "newDesign":"/templ/admin/newDesign.html",
      "newDesignExt":"/templ/admin/newDesignExt.html",
      "designs":"/templ/admin/designs.html",
      "users":"/templ/admin/users.html",
      "institution":"/templ/admin/institution.html",
      "activities":"/templ/admin/activities.html",
      "launchActivity":"/templ/admin/launchActivity.html",
      "viewDesign":"/templ/admin/viewDesign.html",
      "activity":"templ/admin/activity.html",
      "profile":"templ/admin/profile.html",
      "user_admin":"/templ/admin/user_admin.html",
      "institution_admin":"/templ/admin/institution_admin.html",
      "institution_data":"/templ/admin/institution_data.html",
      "accepted_institutions":"/templ/admin/accepted_institutions.html"
    }
   });

//#############################################

adpp.controller("AdminController", function ($scope, $http, $uibModal, $location, $locale, $filter, $socket, $route) {
    var self = $scope;

    self.temp = "";
    const lang = navigator.language
    $locale.NUMBER_FORMATS.GROUP_SEP = '';
    self.shared = {};
    self.sessions = [];
    self.selectedView = '' //current view
    self.activities = [] //activities
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
    if(lang[0] == 'e' && lang[1] == 's'){
        self.lang = "spanish";
    }
    else{
        self.lang = "english";
    }
    
    self.secIcons = { configuration: "cog", editor: "edit", dashboard: "bar-chart", users: "male",
        rubrica: "check-square", groups: "users", options: "sliders" };
    self.typeNames = { L: "readComp", S: "multSel", M: "semUnits", E: "ethics", R: "rolePlaying", T: "ethics", J: "jigsaw" };

    self.misc = {};

    self.init = function () {
        //self.updatelangdata();
        self.getMe();
        
        self.shared.updateSesData();
        self.shared.getActivities();
        self.updateLang(self.lang);
        
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            if (data.ses == self.selectedSes.id) {
                window.location.reload();
            }
        });
    };

    self.updatelangdata = function() {
        var postdata2 = self.uid
        $http({ url: "updatelangdata", method: "post", data: {lang} }).success(function (data) {
            console.log(data)

        });
    };

    self.set_id = function(id) {
        self.inst_id = id
    };
    self.reset_inst_id = function() {
        self.inst_id = 0;
        self.selectView("institution_admin");
    }

    self.getMe = function(){
        $http.get("is-super").success(data => {
            if(data.status == "ok"){
                self.superBar = true;
                self.super = true;
            }
        });
        $http.get("is-institution").success(data => {
            self.institution = data.status;
        });

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

    self.selectActivity = function(activityId, sesId, design){
        self.selectView("activity");
        self.currentActivity.id = activityId;
        self.selectedId = sesId;
        self.selectedSes = getSession(sesId)[0]
        console.log(self.selectedSes)
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
            function(sessions){ return sessions.id == id }
        );
      }

    self.selectView = function(tab){
        if(tab != self.selectedView){
            self.selectedView = tab;
            $route.reload();
            if(tab != "newDesignExt" && tab != "viewDesign") designId.id = null; //avoids making designs-documents request
            if(tab != "launchActivity") launchId.id = null;
            console.log(self.selectedView);
        }
    }

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
    }

    self.shared.getActivities = function(){
        var postdata = { };
        $http({ url: "get-activities", method: "post", data: postdata }).success(function (data) {
            for(var index = 0; index<data.activities.length; index++) data.activities[index].title= data.activities[index].design.metainfo.title
            self.activities = data.activities;
            //console.log(self.activities)
        });
    }

    self.sesFromURL = function () {
        var sesid = +$location.path().substring(1);
        var ses = self.sessions.find(function (e) {
            return e.id == sesid;
        });
        if (ses != null) self.selectSession(ses, sesid);
    };

    self.requestDocuments = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "documents-session", method: "post", data: postdata }).success(function (data) {
            self.documents = data;
        });
    };

    self.shared.updateDocuments = self.requestDocuments;

    self.deleteDocument = function (docid) {
        var postdata = { docid: docid };
        $http({ url: "delete-document", method: "post", data: postdata }).success(function (data) {
            self.requestDocuments();
        });
    };

    self.requestQuestions = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "questions-session", method: "post", data: postdata }).success(function (data) {
            self.questions = data.map(function (e) {
                e.options = e.options.split("\n");
                return e;
            });
        });
        $http({ url: "get-question-text", method: "post", data: postdata }).success(function (data) {
            self.questionTexts = data;
        });
    };

    self.requestSemDocuments = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "semantic-documents", method: "post", data: postdata }).success(function (data) {
            self.semDocs = data;
        });
    };

    self.getNewUsers = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-new-users", method: "post", data: postdata }).success(function (data) {
            self.newUsers = data;
        });
    };

    self.getMembers = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-ses-users", method: "post", data: postdata }).success(function (data) {
            self.usersArr = data;
            self.users = {};
            data.forEach(function (d) {
                self.users[d.id] = d;
            });
        });
    };

    self.openNewSes = function () {
        $uibModal.open({
            templateUrl: "templ/new-ses.html"
        });
    };

    self.openViewSelected = function () { //Displays View Selected
        if(self.selectedView == "TEST"){
            $uibModal.open({
                templateUrl: "templ/home.html"
            });

        }
    };

    self.openDuplicateSes = function () {
        if (self.selectedSes == null) return;
        var ses = angular.copy(self.selectedSes);
        $uibModal.open({
            templateUrl: "templ/duplicate-ses.html",
            controller: "DuplicateSesModalController",
            controllerAs: "vm",
            scope: self,
            resolve: {
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
            templateUrl: "templ/duplicate-ses.html",
            controller: "DuplicateSesModalController",
            controllerAs: "vm",
            scope: self,
            resolve: {
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

    self.updateLang = function (lang) {
        $http.get("data/" + lang + ".json").success(function (data) {
            window.DIC = data;
        });
    };

    self.shared.resetSesId = function () {
        self.selectedId = -1;
    };

    self.changeLang = function () {
        self.lang = self.lang == "english" ? "spanish" : "english";
        self.updateLang(self.lang);
    };

    self.generateCode = function () {
        var postdata = {
            id: self.selectedSes.id
        };
        $http.post("generate-session-code", postdata).success(function (data) {
            if (data.code != null) self.selectedSes.code = data.code;
        });
    };

    self.flang = function (key) {
        return $filter("lang")(key);
    };

    self.init();
});

adpp.controller("TabsController", function ($scope, $http, Notification) {
    var self = $scope;
    self.tabOptions = [];
    self.tabConfig = ["users", "groups"];
    self.selectedTab = '';
    self.archivedTab = false;
    self.stages = [];
    self.iterationNames = [];

    self.shared.resetTab = function () {
        self.selectedTab = "editor";
        if (self.selectedSes != null && self.selectedSes.status > 1) {
            self.selectedTab = "dashboard";
        }
        self.selectedTabConfig = -1;
        if (self.selectedSes.status == 7) {
            self.shared.gotoRubrica();
        }
    };

    self.shared.verifyTabs = function () {
        if (self.selectedSes.type == "R" || self.selectedSes.type == "T" || self.selectedSes.type == "J") {
            self.iterationNames = [];
            self.tabOptions = ["editor", "users", "dashboard"];
            // self.sesStatusses = ["configuration"];
            var pd = {
                sesid: self.selectedSes.id
            };
            console.log("POSTDATA:", pd) //ESTO DEBERIA APARECER
            $http({ url: "get-admin-stages", method: "post", data: pd }).success(function (data) {
                self.stages = data;
                data.forEach(st => {
                    self.iterationNames.push({name: self.flang("stage") + " " + st.number, val: st.id});
                    console.log("iteration NAMES:",self.iterationNames)
                });
            });
        }
        if (self.selectedSes.status > 1) {
            self.selectedTab = "dashboard";
        }
    };

    self.setTab = function (idx) {
        self.selectedTab = idx;
    };

    self.setTabConfig = function (idx) {
        self.selectedTabConfig = idx;
    };

    self.backToList = function () {
        self.shared.resetSesId();
        self.tabOptions = [];
        self.selectedTab = "";
    };

    self.shared.gotoGrupos = function () {
        self.selectedTab = "groups";
    };

    self.shared.gotoRubrica = function () {
        self.selectedTab = "rubrica";
    };

    self.archTab = function(v){
        self.archivedTab = v;
    };

    self.currentSessions = function(){
        return self.sessions.filter(e => !!e.archived == self.archivedTab);
    };

    self.archiveSes = function(ses, $event){
        $event.stopPropagation();
        var postdata = { sesid: ses.id, val: true };
        $http({ url: "archive-session", method: "post", data: postdata }).success(function (data) {
            Notification.info("Sesión archivada");
            ses.archived = true;
        });
    };

    self.restoreSes = function(ses, $event){
        $event.stopPropagation();
        var postdata = { sesid: ses.id, val: false };
        $http({ url: "archive-session", method: "post", data: postdata }).success(function (data) {
            Notification.info("Sesión restaurada");
            ses.archived = false;
        });
    };

    self.archiveActivity = function(ses, $event){
        $event.stopPropagation();
        var postdata = { sesid: ses.session, val: true };
        $http({ url: "archive-session", method: "post", data: postdata }).success(function (data) {
            Notification.info("Sesión archivada");
            ses.archived = true;
        });
    };

    self.restoreActivity = function(ses, $event){
        $event.stopPropagation();
        var postdata = { sesid: ses.session, val: false };
        $http({ url: "archive-session", method: "post", data: postdata }).success(function (data) {
            Notification.info("Sesión restaurada");
            ses.archived = false;
        });
    };

});

adpp.controller("DocumentsController", function ($scope, $http, Notification, $timeout) {
    var self = $scope;

    self.busy = false;
    self.dfs = [];
    self.shared.dfs = self.dfs;

    self.getDifferentials = function () {
        $http.post("differentials", { sesid: self.selectedSes.id }).success(function (data) {
            data.forEach(function (df) {
                df.name = df.title;
                self.dfs[df.orden] = df;
            });
        });
    };

    self.uploadDocument = function (event) {
        self.busy = true;
        var fd = new FormData(event.target);
        $http.post("upload-file", fd, {
            transformRequest: angular.identity,
            headers: { 'Content-Type': undefined }
        }).success(function (data) {
            if (data.status == "ok") {
                $timeout(function () {
                    Notification.success("Documento cargado correctamente");
                    event.target.reset();
                    self.busy = false;
                    self.shared.updateDocuments();
                }, 2000);
            }
        });
    };

    self.sendDFS = function () {
        let k = 0;
        self.misc.dfSending = true;
        self.dfs.forEach(function (df, i) {
            let url = df.id ? "update-differential" : "add-differential";
            df.orden = i;
            df.sesid = self.selectedSes.id;
            $http.post(url, df).success(function (data) {
                k += 1;
                if (k == self.dfs.length - 1) {
                    Notification.success("Diferenciales guardados correctamente");
                    self.misc.dfSending = false;
                    self.getDifferentials();
                }
            });
        });
    };

    self.shared.sendDFS = self.sendDFS;

    self.getDifferentials();
});

adpp.controller("SesEditorController", function ($scope, $http, Notification) {
    var self = $scope;

    self.mTransition = { 1: 3, 3: 5, 5: 6, 6: 8, 8: 9 };

    self.splitDescr = false;
    self.splDes1 = "";
    self.splDes2 = "";

    self.toggleSplit = function () {
        self.splitDescr = !self.splitDescr;
        if (self.splitDescr) {
            self.splDes1 = self.selectedSes.descr.split("\n")[0];
            self.splDes2 = self.selectedSes.descr.split("\n")[1] || "";
        } else {
            self.selectedSes.descr = self.splDes1 + "\n" + self.splDes2;
        }
    };

    self.updateSession = function () {
        if (self.splitDescr) {
            self.selectedSes.descr = self.splDes1 + "\n" + self.splDes2;
        }
        if (self.selectedSes.name.length < 3 || self.selectedSes.descr.length < 5) {
            Notification.error("Datos de la sesión incorrectos o incompletos");
            return;
        }
        var postdata = { name: self.selectedSes.name, descr: self.selectedSes.descr, id: self.selectedSes.id };
        $http({ url: "update-session", method: "post", data: postdata }).success(function (data) {
            console.log("Session updated");
        });
    };

    self.shared.changeState = function () {
        var confirm = window.confirm("¿Esta seguro que quiere ir al siguiente estado?");
        if (confirm) {
            if (self.selectedSes.status == 1) {
                self.updateSession();
            }
            var _postdata = { sesid: self.selectedSes.id };
            $http({ url: "change-state-session", method: "post", data: _postdata }).success(function (data) {
                self.shared.updateSesData();
            });
        }
    };

    /*self.exportData = () => {
        let postdata = {id: self.selectedSes.id};
        $http.post("export-session-data-sel", postdata).success((data) => {
            let anchor = angular.element('<a/>');
            anchor.attr({
                href: 'data:attachment/vnd.openxmlformats,' + encodeURI(data),
                target: '_blank',
                download: 'resultados.xlsx'
            })[0].click();
        });
    }*/
});

adpp.controller("NewUsersController", function ($scope, $http, Notification) {
    var self = $scope;
    var newMembs = [];

    self.addToSession = function () {
        if (self.newMembs.length == 0) {
            Notification.error("No hay usuarios seleccionados para agregar");
            return;
        }
        var postdata = {
            users: self.newMembs.map(function (e) {
                return e.id;
            }),
            sesid: self.selectedSes.id
        };
        $http({ url: "add-ses-users", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                self.refreshUsers();
            }
        });
    };

    self.removeUser = function (uid) {
        if (self.selectedSes.status <= 2) {
            var postdata = { uid: uid, sesid: self.selectedSes.id };
            $http({ url: "delete-ses-user", method: "post", data: postdata }).success(function (data) {
                if (data.status == "ok") {
                    self.refreshUsers();
                }
            });
        }
    };

    self.refreshUsers = function () {
        self.getNewUsers();
        self.getMembers();
    };

    self.shared.refreshUsers = self.refreshUsers;
});

adpp.controller("SemDocController", function ($scope, $http, Notification) {
    var self = $scope;

    self.newSDoc = { id: null, title: "", content: "" };

    self.addSemDoc = function () {
        var postdata = { sesid: self.selectedSes.id, title: self.newSDoc.title, content: self.newSDoc.content };
        $http({ url: "add-semantic-document", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                self.requestSemDocuments();
                Notification.success("Texto agregado correctamente");
                self.newSDoc = { id: null, title: "", content: "" };
            }
        });
    };

    self.deleteText = function (id) {
        var postdata = { id: id };
        $http.post("delete-semantic-document", postdata).success(function (data) {
            if (data.status == "ok") {
                self.requestSemDocuments();
                Notification.success("Texto eliminado correctamente");
            }
        });
    };

    self.startEditText = function (tx) {
        self.newSDoc = { id: tx.id, title: tx.title, content: tx.content };
        Notification.info("Edite el texto en el formulario");
    };

    self.updateSemDoc = function () {
        if (self.newSDoc.id == null) {
            Notification.error("No hay texto a editar.");
            return;
        }
        var postdata = { id: self.newSDoc.id, sesid: self.selectedSes.id, title: self.newSDoc.title, content: self.newSDoc.content };
        $http({ url: "update-semantic-document", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                self.requestSemDocuments();
                Notification.success("Texto editado correctamente.");
                self.newSDoc = { id: null, title: "", content: "" };
            }
        });
    };
});

adpp.controller("DashboardController", function ($scope, $http, $timeout, $uibModal, Notification) {
    var self = $scope;
    self.iterationIndicator = 1;
    self.currentTimer = null;
    self.showCf = false;
    self.dataDF = [];
    self.dataChatCount = {};

    self.shared.resetGraphs = function () { //THIS HAS TO BE CALLED ON ADMIN
        if (self.selectedSes.type == "R" || self.selectedSes.type == "T" || self.selectedSes.type == "J") {
            self.iterationIndicator = self.selectedSes.current_stage || -1;
        }
        self.alumState = null;
        self.barOpts = {
            chart: {
                type: 'multiBarChart',
                height: 320,
                x: function x(d) {
                    return d.label;
                },
                y: function y(d) {
                    return d.value;
                },
                showControls: false,
                showValues: false,
                duration: 500,
                xAxis: {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: self.flang('students')
                }
            }
        };
        self.barData = [{ key: self.flang('students'), color: "#0077c1", values: [] }];
        self.updateState();
        if (DASHBOARD_AUTOREALOD && self.selectedSes.status < 9) {
            self.reload(true);
        }
    };

    self.reload = function (k) {
        if (!k) {
            self.updateState();
        }
        if (self.currentTimer != null) {
            $timeout.cancel(self.currentTimer);
        }
        self.currentTimer = $timeout(self.reload, DASHBOARD_AUTOREALOD_TIME * 1000);
    };

    self.updateState = function () {
        if (self.selectedSes.status == 1) {
            self.shared.refreshUsers();
        }
        else if (self.iterationIndicator <= 4 || self.selectedSes.type == "R" || self.selectedSes.type == "T" || self.selectedSes.type == "J") {
            self.updateStateIni();
        }
        else {
            self.updateStateRub();
        }
    };

    self.shared.updateState = self.updateState;

    self.shared.setIterationIndicator = function(i){
        console.log("Set iteration Indicatior:",i)
        self.iterationIndicator = i;
        self.updateState();
    };

    self.updateStateIni = function () {
        console.log(self.iterationIndicator);
        self.alumTime = {};
        var postdata = { sesid: self.selectedSes.id, iteration: self.iterationIndicator };
        if (self.selectedSes.type == "R") {
            var _postdata2 = {
                stageid: self.iterationIndicator
            };
            $http.post("get-actors", _postdata2).success(function(data){
                self.rawActors = data;
                self.actorMap = {};
                data.forEach(a => {
                    self.actorMap[a.id] = a;
                });
                $http.post("get-role-sel-all", _postdata2).success(function (data) {
                    self.rawRoleData = data;
                    self.posFreqTable = window.computePosFreqTable(data, self.rawActors);
                    if(self.posFreqTable != null) {
                        self.freqMax = Object.values(self.posFreqTable)
                            .reduce((v, e) => Math.max(v, Object.values(e).reduce((v2, e2) => Math.max(e2, v2), 0)), 0);
                    }
                    self.indvTable = window.computeIndTable(data, self.rawActors);
                    self.shared.roleIndTable = self.indvTable;
                    self.indvTableSorted = window.sortIndTable(self.indvTable, self.users);
                });
                $http({ url: "group-proposal-stage", method: "post", data: _postdata2 }).success(function (data) {
                    self.shared.groupByUid = {};
                    data.forEach(function (s, i) {
                        s.forEach(function (u) {
                            self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        });
                    });
                });
                $http({ url: "get-chat-count-stage", method: "post", data: _postdata2 }).success(function (data) {
                    self.shared.chatByUid = {};
                    self.shared.chatByTeam = {};
                    data.forEach(function(c) {
                        self.shared.chatByUid[c.uid] = +c.count;
                        if(!self.shared.chatByTeam[c.tmid]){
                            self.shared.chatByTeam[c.tmid] = 0;
                        }
                        self.shared.chatByTeam[c.tmid] += +c.count;
                    });
                });
            });
        }
        else if (self.selectedSes.type == "T"){
            var _postdata2 = {
                stageid: self.iterationIndicator
            };
            self.dfsStage = [];
            $http.post("get-differentials-stage", _postdata2).success(function(data) {
                self.dfsStage = data;
                console.log("DIFFERENTIAL DEBUG DATA:",data)
                $http.post("get-differential-all-stage", _postdata2).success(function (data) {
                    self.shared.difTable = window.buildDifTable(data, self.users, self.dfsStage, self.shared.groupByUid);
                    self.shared.difTableUsers = self.shared.difTable.filter(e => !e.group).length;
                });
            });
            $http({ url: "group-proposal-stage", method: "post", data: _postdata2 }).success(function (data) {
                self.shared.groupByUid = {};
                self.shared.groupByTmid = {};
                data.forEach(function (s, i) {
                    s.forEach(function (u) {
                        self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        self.shared.groupByTmid[u.tmid] = { index: i + 1, tmid: u.tmid };
                    });
                });
            });
            $http({ url: "get-dif-chat-count", method: "post", data: _postdata2 }).success(function (data) {
                self.shared.chatByUid = {};
                self.shared.chatByTeam = {};
                data.forEach(function(c) {
                    if(!self.shared.chatByUid[c.did])
                        self.shared.chatByUid[c.did] = {};
                    self.shared.chatByUid[c.did][c.uid] = +c.count;
                    if(!self.shared.chatByTeam[c.did])
                        self.shared.chatByTeam[c.did] = {};
                    if(!self.shared.chatByTeam[c.did][c.tmid]){
                        self.shared.chatByTeam[c.did][c.tmid] = 0;
                    }
                    self.shared.chatByTeam[c.did][c.tmid] += +c.count;
                });
            });
        }
        else if (self.selectedSes.type == "J"){
            var _postdata2 = {
                stageid: self.iterationIndicator
            };
            if(self.shared.inputAssignedRoles) {
                self.shared.inputAssignedRoles();
            }
            $http.post("get-actors", _postdata2).success(function(data){
                self.rawActors = data;
                self.actorMap = {};
                data.forEach(a => {
                    self.actorMap[a.id] = a;
                });
                $http.post("get-role-sel-all", _postdata2).success(function (data) {
                    self.rawRoleData = data;
                    self.posFreqTable = window.computePosFreqTable(data, self.rawActors);
                    if(self.posFreqTable != null) {
                        self.freqMax = Object.values(self.posFreqTable)
                            .reduce((v, e) => Math.max(v, Object.values(e).reduce((v2, e2) => Math.max(e2, v2), 0)), 0);
                    }
                    self.indvTable = window.computeIndTable(data, self.rawActors);
                    self.shared.roleIndTable = self.indvTable;
                    self.indvTableSorted = window.sortIndTable(self.indvTable, self.users);
                });
                $http({ url: "group-proposal-stage", method: "post", data: _postdata2 }).success(function (data) {
                    self.shared.groupByUid = {};
                    data.forEach(function (s, i) {
                        s.forEach(function (u) {
                            self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        });
                    });
                });
                $http({ url: "get-chat-count-stage", method: "post", data: _postdata2 }).success(function (data) {
                    self.shared.chatByUid = {};
                    self.shared.chatByTeam = {};
                    data.forEach(function(c) {
                        self.shared.chatByUid[c.uid] = +c.count;
                        if(!self.shared.chatByTeam[c.tmid]){
                            self.shared.chatByTeam[c.tmid] = 0;
                        }
                        self.shared.chatByTeam[c.tmid] += +c.count;
                    });
                });
            });
        }
    };

    self.getFreqColor = function(aid, pos){
        if(self.posFreqTable && self.posFreqTable[aid]) {
            let val = self.posFreqTable[aid][pos] || 0;
            let p = val / self.freqMax;

            return {
                "background": "rgba(0, 184, 166, " + p + ")"
            }
        }
    };

    self.avgAlum = function (uid) {
        if (self.alumState != null && self.alumState[uid] != null) {
            var t = 0;
            var c = 0;
            for (var k in self.alumState[uid]) {
                if (self.alumState[uid][k]) c++;
                t++;
            }
            return t > 0 ? 100 * c / t : 0;
        }
        return 0;
    };

    self.avgPreg = function (pid) {
        if (self.alumState != null) {
            var t = 0;
            var c = 0;
            for (var k in self.alumState) {
                if (self.alumState[k] != null && self.alumState[k][pid] != null) {
                    if (self.alumState[k][pid]) c++;
                    t++;
                }
            }
            return t > 0 ? 100 * c / t : 0;
        }
        return 0;
    };

    self.avgAll = function () {
        var t = 0;
        var c = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                for (var k in self.alumState[u]) {
                    if (self.alumState[u][k]) c++;
                    t++;
                }
            }
        }
        return t > 0 ? 100 * c / t : 0;
    };

    self.progress = function () {
        var t = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                for (var k in self.alumState[u]) {
                    t++;
                }
            }
            return 100 * t / (Object.keys(self.alumState).length * self.questions.length);
        }
        return 0;
    };

    self.progressAlum = function (uid) {
        var t = 0;
        if (self.alumState != null && self.alumState[uid] != null) {
            for (var k in self.alumState[uid]) {
                t++;
            }
            return 100 * t / self.questions.length;
        }
        return 0;
    };

    self.progressPreg = function (pid) {
        var t = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                if (self.alumState[u][pid] != null) {
                    t++;
                }
            }
            return 100 * t / Object.keys(self.alumState).length;
        }
        return 0;
    };

    self.lectPerformance = function () {
        var t = 0;
        var c = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                var a = self.alumState[u];
                t++;
                c += a.score;
            }
            return 100 * c / t;
        }
        return 0;
    };

    self.DFAll = function (ans, orden) {
        return ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
    };

    self.DFL = function (ans, orden) {
        return ans.filter(function (e) {
            return e.orden == orden;
        }).length;
    };

    self.DFAvg = function (ans, orden) {
        var a = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        return a.length > 0 ? a.reduce(function (v, e) {
            return v + e;
        }, 0) / a.length : 0;
    };

    self.DFMinMax = function (ans, orden) {
        var a = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        a.sort();
        var n = a.length - 1;
        return a[n] - a[0];
    };

    self.DFColor = function (ans, orden) {
        var avg = self.DFAvg(ans, orden);
        var sd = 0;
        var arr = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        arr.forEach(function (a) {
            sd += (a - avg) * (a - avg);
        });
        var dif = Math.sqrt(sd / (arr.length - 1));

        if (dif <= 1) return "bg-darkgreen";
        else if (dif > 2.8) return "bg-red";
        else return "bg-yellow";
    };

    self.getAlumDoneTime = function (postdata) {
        $http({ url: "get-alum-done-time", method: "post", data: postdata }).success(function (data) {
            self.numComplete = 0;
            data.forEach(function (row) {
                self.numComplete += 1;
                if (self.alumState[row.uid] == null) self.alumState[row.uid] = row;else self.alumState[row.uid].dtime = ~~row.dtime;
            });
        });
    };

    self.buildBarData = function (data) {
        var N = 5;
        self.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            var lbl = i * 20 + "% - " + (i + 1) * 20 + "%";
            self.barData[0].values.push({ label: lbl, value: 0 });
        }
        data.forEach(function (d) {
            var rank = Math.min(Math.floor(N * d.score), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = self.flang("performance");
    };

    self.updateStateRub = function () {
        if (self.iterationIndicator == 5) self.computeDif();else if (self.iterationIndicator == 6) self.getAllReportResult();
    };

    self.showName = function (report) {
        if (report.example) return report.title + " - " + self.flang("exampleReport");else return report.id + " - " + self.flang("reportOf") + " " + self.users[report.uid].name;
    };

    self.shared.getReports = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-report-list", method: "post", data: postdata }).success(function (data) {
            self.reports = data;
            self.exampleReports = data.filter(function (e) {
                return e.example;
            });
        });
    };

    self.getReportResult = function () {
        var postdata = { repid: self.selectedReport.id };
        $http({ url: "get-report-result", method: "post", data: postdata }).success(function (data) {
            self.result = data;
            self.updateState();
        });
    };

    self.getAllReportResult = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-report-result-all", method: "post", data: postdata }).success(function (data) {
            self.resultAll = {};
            var n = data.length;
            for (var uid in self.users) {
                if (self.users[uid].role == "A") self.resultAll[uid] = { reviews: 0, data: [] };
            }
            data.forEach(function (d) {
                if (d != null && d.length > 0) {
                    var _uid = self.getReportAuthor(d[0].rid);
                    if (_uid != -1 && self.resultAll[_uid].data == null) {
                        self.resultAll[_uid].data = d;
                    } else if (_uid != -1) {
                        self.resultAll[_uid].data = d;
                    }
                    d.forEach(function (ev) {
                        self.resultAll[ev.uid].reviews += n;
                    });
                }
            });
            self.pairArr = data[0] ? new Array(data[0].length) : [];
            //console.log(self.resul);
            self.buildRubricaBarData(data);
        });
    };

    self.buildRubricaBarData = function (data) {
        var N = 3;
        //let rubnms = [self.flang("") + "-" + self.flang(""), "Proceso-Competente", "Competente-Avanzado"];
        var rubnms = ["1 - 2", "2 - 3", "3 - 4"];
        self.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            var lbl = i + 1 + " - " + (i + 2) + " (" + rubnms[i] + ")";
            self.barData[0].values.push({ label: lbl, value: 0 });
        }
        data.forEach(function (d) {
            var score = d.reduce(function (e, v) {
                return e + v.val;
            }, 0) / d.length;
            var rank = Math.min(Math.floor(score - 1), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = self.flang("scoreDist");
    };

    self.computeDif = function () {
        if (self.result) {
            var pi = self.result.findIndex(function (e) {
                return self.users[e.uid].role == 'P';
            });
            if (pi != -1) {
                var pval = self.result[pi].val;
                var difs = [];
                self.result.forEach(function (e, i) {
                    if (i != pi) {
                        difs.push(Math.abs(pval - e.val));
                    }
                });
                self.buildRubricaDiffData(difs);
            }
        }
    };

    self.buildRubricaDiffData = function (difs) {
        console.log("difs", difs);
        var N = 5;
        var lblnms = self.flang("high2lowScale").split(",");
        self.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            // let lbl = (i * 0.5) + " - " + (i + 1) * 0.5;
            self.barData[0].values.push({ label: lblnms[i], value: 0 });
        }
        difs.forEach(function (d) {
            var rank = Math.min(Math.floor(d * 2), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = self.flang("correctDistance");
    };

    self.getReportAuthor = function (rid) {
        if (self.reports) {
            var rep = self.reports.find(function (e) {
                return e.id == rid;
            });
            return rep ? rep.uid : -1;
        }
        return -1;
    };

    self.getAvg = function (row) {
        if (row == null || row.length == 0) return "";
        var s = row.reduce(function (v, e) {
            return v + e.val;
        }, 0);
        return s / row.length;
    };

    self.getInMax = function (res) {
        if (res == null) return [];
        var n = 0;
        for (var u in res) {
            n = Math.max(n, res[u].data.length);
        }
        return new Array(n);
    };

    self.showReport = function (rid) {
        var postdata = { rid: rid };
        $http({ url: "get-report", method: "post", data: postdata }).success(function (data) {
            var modalData = { report: data, criterios: self.shared.obtainCriterios() };
            modalData.report.author = self.users[data.uid];
            var postdata = { repid: data.id };
            $http({ url: "get-report-result", method: "post", data: postdata }).success(function (data) {
                modalData.answers = data;
                $http.post("get-criteria-selection-by-report", postdata).success(function (data) {
                    modalData.answersRubrica = {};
                    data.forEach(function (row) {
                        if (modalData.answersRubrica[row.uid] == null) modalData.answersRubrica[row.uid] = {};
                        modalData.answersRubrica[row.uid][row.cid] = row.selection;
                    });
                    $http.post("get-report-evaluators", postdata).success(function (data) {
                        data.forEach(function (row) {
                            var i = modalData.answers.findIndex(function (e) {
                                return e.uid == row.uid;
                            });
                            if (i == -1) modalData.answers.push({ uid: row.uid, evaluatorName: self.users[row.uid].name });else modalData.answers[i].evaluatorName = self.users[row.uid].name;
                        });
                        $uibModal.open({
                            templateUrl: "templ/report-details.html",
                            controller: "ReportModalController",
                            controllerAs: "vm",
                            size: "lg",
                            scope: self,
                            resolve: {
                                data: function data() {
                                    return modalData;
                                }
                            }
                        });
                    });
                });
            });
        });
    };

    self.showReportByUid = function (uid) {
        console.log(uid);
        var postdata = { uid: uid, sesid: self.selectedSes.id };
        $http({ url: "get-report-uid", method: "post", data: postdata }).success(function (data) {
            var modalData = { report: data };
            modalData.report.author = self.users[uid];
            $uibModal.open({
                templateUrl: "templ/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function data() {
                        return modalData;
                    }
                }
            });
        });
    };

    self.broadcastReport = function (rid) {
        var postdata = { sesid: self.selectedSes.id, rid: rid };
        $http({ url: "set-eval-report", method: "post", data: postdata }).success(function (data) {
            Notification.success("Reporte enviado a alumnos");
        });
    };

    self.showDetailAnswer = function (qid, uid, it) {
        var opts = ["A", "B", "C", "D", "E"];
        var postdata = { uid: uid, qid: qid, iteration: it };
        var qs = self.questions.reduce(function (e, v) {
            return v.id == qid ? v : e;
        }, null);
        if (it < 3) {
            $http({ url: "get-selection-comment", method: "post", data: postdata }).success(function (_data) {
                if (_data == null || _data.answer == null) {
                    Notification.warning("No hay respuesta registrada para el alumno");
                    return;
                }
                var alt = opts[_data.answer] + ". " + qs.options[_data.answer];
                var qstxt = qs.content;
                $uibModal.open({
                    templateUrl: "templ/content-dialog.html",
                    controller: "ContentModalController",
                    controllerAs: "vm",
                    scope: self,
                    resolve: {
                        data: function data() {
                            _data.title = self.flang("answerOf") + " " + self.users[uid].name;
                            _data.content = self.flang("question") + ":\n" + qstxt + "\n\n" + self.flang("answer") + ":\n" + alt + "\n\n" + self.flang("comment") + ":\n" + (_data.comment ? _data.comment : "");
                            if (_data.confidence) {
                                _data.content += "\n\n" + self.flang("confidenceLevel") + ": " + _data.confidence + "%";
                            }
                            return _data;
                        }
                    }
                });
            });
        } else {
            postdata.tmid = self.leaderTeamId[uid];
            $http({ url: "get-selection-team-comment", method: "post", data: postdata }).success(function (res) {
                if (res == null || res.length == 0) {
                    Notification.warning("No hay respuesta registrada para el grupo");
                    return;
                }
                var alt = opts[res[0].answer] + ". " + qs.options[res[0].answer];
                var qstxt = qs.content;
                $uibModal.open({
                    templateUrl: "templ/content-dialog.html",
                    controller: "ContentModalController",
                    controllerAs: "vm",
                    scope: self,
                    resolve: {
                        data: function data() {
                            var data = {};
                            data.title = self.flang("answerOf") + " " + self.leaderTeamStr[uid];
                            data.content = self.flang("question") + ":\n" + qstxt + "\n\n" + self.flang("answer") + ":\n" + alt + "\n\n";
                            res.forEach(function (r) {
                                data.content += self.flang("comment") + " " + r.uname + ":\n" + (r.comment != null ? r.comment : "") + "\n";
                                if (r.confidence != null) {
                                    data.content += self.flang("confidenceLevel") + ": " + r.confidence + "%\n";
                                }
                                data.content += "\n";
                            });

                            return data;
                        }
                    }
                });
            });
        }
    };

    self.openDFDetails = function (group, orden) {
        var postdata = {
            sesid: self.selectedSes.id,
            tmid: group,
            orden: orden
        };
        $http.post("get-team-chat", postdata).success(function (res) {
            $uibModal.open({
                templateUrl: "templ/differential-group.html",
                controller: "EthicsModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function data() {
                        var data = {};
                        data.names = [self.flang("individual"), self.flang("anon"), self.flang("teamWork")];
                        data.orden = orden;
                        data.group = group;
                        data.users = self.users;
                        var dfgr = self.dataDF.find(function (e) {
                            return e.tmid == group;
                        });
                        // console.log(self.shared);
                        if (dfgr.ind.some(function (e) {
                            return e.orden == orden;
                        })) {
                            var dfgri = dfgr.ind.find(function (e) {
                                return e.orden == orden;
                            });
                            data.master = self.shared.dfs.filter(function (e) {
                                return e.id;
                            }).find(function (e) {
                                return e.id == dfgri.did;
                            });
                        }
                        data.dfIters = [];
                        data.dfIters.push(dfgr.ind.filter(function (e) {
                            return e.orden == orden;
                        }));
                        data.dfIters.push(dfgr.anon.filter(function (e) {
                            return e.orden == orden;
                        }));
                        data.dfIters.push(dfgr.team.filter(function (e) {
                            return e.orden == orden;
                        }));
                        data.anonNames = {};
                        data.sesid = self.selectedSes.id;
                        var abcd = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        var c = 0;
                        data.dfIters.flat().forEach(function (e) {
                            if (!data.anonNames[e.uid]) {
                                data.anonNames[e.uid] = abcd[c];
                                c++;
                            }
                        });
                        data.chat = res;
                        data.chat.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.chat.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                        });
                        console.log(data);
                        return data;
                    }
                }
            });
        });
    };

    self.openDF2Details = function (group, did, uid) {
        console.log(group, did, uid);
        var postdata = {
            stageid: self.iterationIndicator,
            tmid: group,
            did: did
        };
        $http.post("get-team-chat-stage-df", postdata).success(function (res) {
            $uibModal.open({
                templateUrl: "templ/differential-group-2.html",
                controller: "EthicsModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function data() {
                        var data = {};
                        data.names = [self.flang("answer")];
                        data.group = group;
                        data.users = self.users;

                        data.df = self.dfsStage.find(e => e.id == did);

                        data.anonNames = {};
                        data.sesid = self.selectedSes.id;

                        data.chat = res;
                        let i = 0;
                        let abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.chat.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.chat.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                            if(!data.anonNames[msg.uid]){
                                data.anonNames[msg.uid] = abc[i];
                                i += 1;
                            }
                        });

                        data.stage = self.shared.stagesMap[self.iterationIndicator];

                        if(data.stage.type == "team"){
                            data.arr = self.shared.difTable.filter(e => e.tmid == group && !e.group);
                        }
                        else {
                            data.arr = self.shared.difTable.filter(e => e.uid == uid && !e.group);
                        }

                        data.arr.forEach(e => {
                            let el = e.arr.find(e => e && e.did == did);
                            e.sel = el ? el.sel : null;
                            e.comment = el ? el.comment : null;
                            if(!data.anonNames[e.uid]){
                                data.anonNames[e.uid] = abc[i];
                                i += 1;
                            }
                        });

                        data.dfarr = self.shared.buildArray(data.df.num);

                        console.log(data);
                        return data;
                    }
                }
            });
        });
    };

    self.openActorDetails = function  (uid, stageid) {
        let group = self.shared.groupByUid ? self.shared.groupByUid[uid] ? self.shared.groupByUid[uid].tmid : null : null;
        var postdata = {
            stageid: stageid,
            tmid: group
        };
        $http.post("get-team-chat-stage", postdata).success(function (res) {
            $uibModal.open({
                templateUrl: "templ/actor-dialog.html",
                controller: "EthicsModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function data() {
                        var data = {};
                        data.group = group;
                        data.users = self.users;
                        data.actorMap = self.actorMap;

                        data.anonNames = {};
                        data.sesid = self.selectedSes.id;

                        data.chat = res;
                        let i = 0;
                        let abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.chat.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.chat.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                            if(!data.anonNames[msg.uid]){
                                data.anonNames[msg.uid] = abc[i];
                                i += 1;
                            }
                        });

                        data.stage = self.shared.stagesMap[stageid];

                        if(data.stage.type == "team"){
                            data.sel = self.indvTableSorted.filter(e => self.shared.groupByUid[e.uid].index == self.shared.groupByUid[uid].index);
                        }
                        else {
                            data.sel = self.indvTableSorted.filter(e => e.uid == uid);
                        }

                        data.sel.forEach(e => {
                            if(!data.anonNames[e.uid]){
                                data.anonNames[e.uid] = abc[i];
                                i += 1;
                            }
                        });

                        console.log(data);
                        return data;
                    }
                }
            });
        });
    };



    self.exportCSV = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        $http.post("get-sel-data-csv", postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename: "seleccion_" + self.selectedSes.id + ".csv",
                    formatter: function(v){
                        if(v == null){
                            return "";
                        }
                        if(typeof(v) == "string"){
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            }
            else {
                Notification.error("No hay datos de selección para exportar");
            }
        });
        $http.post("get-chat-data-csv", postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename: "chat_" + self.selectedSes.id + ".csv",
                    formatter: function(v){
                        if(v == null){
                            return "";
                        }
                        if(typeof(v) == "string"){
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            }
            else {
                Notification.error("No hay datos de chat para exportar");
            }
        });
    };

    self.exportChatCSV = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        let url = self.selectedSes.type == "T" ? "get-chat-data-csv-ethics" :
            self.selectedSes.type == "R" ? "get-chat-data-csv-role" : null;
        if(url == null){
            Notification.error("No se puede exportar los datos");
            return;
        }
        $http.post(url, postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename: "chat_" + self.selectedSes.id + ".csv",
                    formatter: function(v){
                        if(v == null){
                            return "";
                        }
                        if(typeof(v) == "string"){
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            }
            else {
                Notification.error("No hay datos para exportar");
            }
        });
    };

    self.exportSelCSV = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        let url = self.selectedSes.type == "T" ? "get-sel-data-csv-ethics" :
            self.selectedSes.type == "R" ? "get-sel-data-csv-role" :
            self.selectedSes.type == "J" ? "get-sel-data-csv-jigsaw" : null;
        console.log(self.selectedSes);
        if(url == null){
            Notification.error("No se puede exportar los datos");
            return;
        }
        $http.post(url, postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename: "sel_" + self.selectedSes.id + ".csv",
                    formatter: function(v){
                        if(v == null){
                            return "";
                        }
                        if(typeof(v) == "string"){
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            }
            else {
                Notification.error("No hay datos para exportar");
            }
        });
    };

    self.sortByAutorName = (a, b) => {
        let ua = self.users[a] ? self.users[a].name : a;
        let ub = self.users[b] ? self.users[b].name : b;
        return ua < ub ? -1 : 1;
    };

    self.sortByAutorGroup = (a, b) => {
        return self.shared.groupByUid[a].index - self.shared.groupByUid[b].index;
    };

});

adpp.controller("MapSelectionModalController", function ($scope, $uibModalInstance) {
    var vm = this;

    vm.nav = true;
    vm.edit = false;

    vm.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };

    vm.resolve = function () {
        $uibModalInstance.close({
            nav: vm.nav,
            edit: vm.edit
        });
    };
});

adpp.controller("ReportModalController", function ($scope, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;

    vm.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };
});

adpp.controller("ContentModalController", function ($scope, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;

    vm.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };
});

adpp.controller("EthicsModalController", function ($scope, $http, $uibModalInstance, Notification, data) {
    var vm = this;
    vm.data = data;
    vm.isAnon = true;

    vm.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };

    vm.shareDetails = function () {
        if (!vm.isAnon) {
            Notification.error("Sólo se pueden enviar diferenciales en forma anónima");
            return;
        }
        var content = document.getElementById("details-modal").innerHTML.replace(/<\!--.*?-->/g, "");
        var postdata = {
            sesid: vm.data.sesid,
            content: content
        };
        $http({ url: "broadcast-diff", method: "post", data: postdata }).success(function (data) {
            Notification.success("Diferencial enviado exitosamente");
        });
    };
});

adpp.controller("DuplicateSesModalController", function ($scope, $http, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;
    vm.nses = {
        name: vm.data.name,
        tipo: vm.data.type,
        descr: vm.data.descr,
        originalSesid: vm.data.id,
        copyDocuments: false,
        copyIdeas: false,
        copyQuestions: false,
        copyRubrica: false,
        copyUsers: false,
        copySemUnits: false,
        copySemDocs: false,
        copyDifferentials: false
    };

    vm.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };

    vm.sendDuplicate = function () {
        console.log(vm.nses);
        $http({ url: "duplicate-session", method: "post", data: vm.nses }).success(function (data) {
            console.log(data);
            window.location.replace("admin");
        });
    };

});

adpp.controller("GroupController", function ($scope, $http, Notification) {
    var self = $scope;
    self.methods = [];
    self.lastI = -1;
    self.lastJ = -1;
    self.groupMet = "random";

    self.shared.verifyGroups = function () {
        self.methods = [klg("random"), klg("performance", "homog"), klg("performance", "heterg"), klg("knowledgeType", "homog"), klg("knowledgeType", "heterg")];
        self.groupNum = 3;
        self.groupMet = self.methods[0].key;
        self.groups = [];
        self.groupNames = [];
        if (self.selectedSes != null && self.selectedSes.grouped) {
            self.groupNum = null;
            self.groupMet = null;
            self.generateGroups(true);
        }
    };

    var klg = function klg(k1, k2) {
        return {
            key: k1 + (k2 == null ? "" : " " + k2),
            name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2))
        };
    };

    self.generateGroups = function (key) {
        if (self.selectedSes.grouped) {
            $http({ url: "group-proposal-sel", method: "post", data: { sesid: self.selectedSes.id } }).success(function (data) {
                self.groups = data;
                self.shared.groups = self.groups;
                //self.groupsProp = angular.copy(self.groups);
                console.log("G", data);
                //self.groupNames = [];
            });
            return;
        }
        if (key == null && (self.groupNum < 1 || self.groupNum > self.users.length)) {
            Notification.error("Error en los parámetros de formación de grupos");
            return;
        }

        var postdata = {
            sesid: self.selectedSes.id,
            gnum: self.groupNum,
            method: self.groupMet
        };

        console.log(postdata);

        console.log(self.shared.alumState);
        var users = Object.values(self.users).filter(function (e) {
            return e.role == "A";
        });
        console.log(users);

        if (self.groupMet == "knowledgeType homog" || self.groupMet == "knowledgeType heterg") {
            self.groups = generateTeams(users, habMetric, self.groupNum, isDifferent(self.groupMet));
        } else if (self.groupMet == "random") {
            var arr = users.map(function (e) {
                e.rnd = Math.random();
                return e;
            });
            self.groups = generateTeams(arr, function (s) {
                return s.rnd;
            }, self.groupNum, false);
        } 
        if (self.groups != null) {
            self.groupsProp = angular.copy(self.groups);
            self.groupNames = [];
        }

        /*if (urlRequest != "") {
            $http({url: urlRequest, method: "post", data: postdata}).success((data) => {
                self.groups = data;
                self.groupsProp = angular.copy(self.groups);
                console.log(data);
                self.groupNames = [];
                /*data.forEach((d) => {
                 self.groupNames.push(d.map(i => self.users[i.uid].name).join(", "));
                 });*
            });
        }*/
    };

    self.acceptGroups = function () {
        if (self.groupsProp == null) {
            Notification.error("No hay propuesta de grupos para fijar");
            return;
        }
        var postdata = {
            sesid: self.selectedSes.id,
            groups: JSON.stringify(self.groups.map(function (e) {
                return e.map(function (f) {
                    return f.uid || f.id;
                });
            }))
        };
        console.log(postdata);
        $http({ url: "set-groups", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                console.log("Groups accepted");
                self.selectedSes.grouped = true;
                self.shared.verifyGroups();
            }
        });
    };

    self.swapTable = function (i, j) {
        console.log(i, j, self.groups);
        if (self.lastI == -1 && self.lastJ == -1) {
            self.lastI = i;
            self.lastJ = j;
            return;
        }
        if (!(self.lastI == i && self.lastJ == j)) {
            var temp = angular.copy(self.groupsProp[i][j]);
            self.groupsProp[i][j] = angular.copy(self.groupsProp[self.lastI][self.lastJ]);
            self.groupsProp[self.lastI][self.lastJ] = temp;
        }
        self.lastI = -1;
        self.lastJ = -1;
    };
});

adpp.controller("RubricaController", function ($scope, $http) {
    var self = $scope;
    self.criterios = [];
    self.newCriterio = {};
    self.editable = false;
    self.exampleReports = [];
    self.newExampleReport = "";
    self.pairNum = 3;
    self.rid = -1;

    self.addCriterio = function () {
        self.criterios.push({});
    };

    self.removeCriterio = function (idx) {
        self.criterios.splice(idx, 1);
    };

    self.checkSum = function () {
        return self.criterios.reduce(function (e, p) {
            return e + p.pond;
        }, 0) == 100;
    };

    self.shared.getRubrica = function () {
        self.criterios = [];
        self.newCriterio = {};
        self.editable = false;
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-admin-rubrica", method: "post", data: postdata }).success(function (data) {
            if (data.length == 0) {
                self.editable = true;
            } else {
                self.criterios = data;
                self.rid = data[0].rid;
            }
        });
    };

    self.startEditing = function () {
        self.editable = true;
    };

    self.saveRubrica = function () {
        if (self.rid != -1) {
            self.saveEditRubrica();
            return;
        }
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "send-rubrica", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                var rid = data.id;
                self.criterios.forEach(function (criterio) {
                    var postdata = angular.copy(criterio);
                    postdata.rid = rid;
                    $http({ url: "send-criteria", method: "post", data: postdata }).success(function (data) {
                        if (data.status == "ok") console.log("Ok");
                    });
                });
                self.editable = false;
            }
        });
    };

    self.saveEditRubrica = function () {
        if (self.rid == -1) return;
        var postdata = { rid: self.rid };
        $http({ url: "delete-criterias", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                var rid = self.rid;
                self.criterios.forEach(function (criterio) {
                    var postdata = angular.copy(criterio);
                    postdata.rid = rid;
                    $http({ url: "send-criteria", method: "post", data: postdata }).success(function (data) {
                        if (data.status == "ok") console.log("Ok");
                    });
                });
                self.editable = false;
            }
        });
    };

    self.shared.getExampleReports = function () {
        self.exampleReports = [];
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-example-reports", method: "post", data: postdata }).success(function (data) {
            self.exampleReports = data;
        });
    };

    self.sendExampleReport = function () {
        var postdata = {
            sesid: self.selectedSes.id,
            content: self.newExampleReport.text,
            title: self.newExampleReport.title
        };
        $http({ url: "send-example-report", method: "post", data: postdata }).success(function (data) {
            self.newExampleReport = "";
            self.shared.getExampleReports();
        });
    };

    self.setActiveExampleReport = function (rep) {
        var postdata = { sesid: self.selectedSes.id, rid: rep.id };
        $http({ url: "set-active-example-report", method: "post", data: postdata }).success(function (data) {
            if (data.status == 'ok') {
                self.exampleReports.forEach(function (r) {
                    r.active = false;
                });
                rep.active = true;
            }
        });
    };

    self.goToReport = function (rep) {
        self.setActiveExampleReport(rep);
        window.location.href = "to-rubrica?sesid=" + self.selectedSes.id;
    };

    self.pairAssign = function () {
        var postdata = { sesid: self.selectedSes.id, rnum: +self.pairNum || 3 };
        $http({ url: "assign-pairs", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                // self.shared.updateSesData();
                self.selectedSes.paired = self.pairNum;
                self.errPairMsg = "";
            } else {
                self.errPairMsg = data.msg;
            }
        });
    };

    self.shared.obtainCriterios = function () {
        return self.criterios;
    };

    self.shared.isRubricaSet = function () {
        return !self.editable;
    };
});

adpp.controller("DesignsDocController", function ($scope, $http, Notification, $timeout) { 
    var self = $scope;
    self.busy = false;
    self.documents = [];

    self.init = function(){
        self.requestDesignDocuments();
    }

    self.uploadDesignDocument = function (event) { //Work in progress
        self.busy = true;
        var fd = new FormData(event.target);
        $http.post("upload-design-file", fd, {
            transformRequest: angular.identity,
            headers: { 'Content-Type': undefined }
        }).success(function (data) {
            if (data.status == "ok") {
                $timeout(function () {
                    //Notification.success("Documento cargado correctamente");
                    event.target.reset();
                    self.busy = false;
                    //self.shared.updateDocuments();
                    self.requestDesignDocuments();
                }, 2000);
            }
        });
    };
    
    self.requestDesignDocuments = function ( ) {
        var postdata = { dsgnid: designId.id};
        $http({ url: "designs-documents", method: "post", data: postdata }).success(function (data) {
            self.documents = data;
        });
    };


    self.deleteDesignDocument = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({ url: "delete-design-document", method: "post", data: postdata }).success(function (data) {
            self.requestDesignDocuments();
        });
    };

    self.getPathname = function(path){
        var split = path.split("/")
        return split[split.length - 1]
    }

    self.init()

});

adpp.controller("ActivityController", function ($scope, $filter, $http, Notification, $timeout) {
    var self = $scope;
    self.selectedSes = {};

    self.init =function(){
        self.selectedSes = {};
    }


    self.createSession = function(dsgnName, dsgndescr, dsgntype, dsgnid){
        var postdata = { name: dsgnName, descr: dsgndescr, type:dsgntype};
        $http({ url: "add-session-activity", method: "post", data: postdata }).success(function (data) {
            console.log("SESSION CREATED");
            var id = data.id;
            self.createActivity(id, dsgnid,);
            self.generateCodeActivity(id);
            self.shared.getActivities();
            self.shared.updateSesData();
            //console.log(data);
        });
    }

    self.createActivity = function(sesID, dsgnID){
        var postdata = { sesid: sesID, dsgnid: dsgnID};
        $http({ url: "add-activity", method: "post", data: postdata }).success(function (data) {
            console.log("ACTIVITY CREATED");
            var dsng = data.result
            self.startActivityDesign(dsng, sesID)
            self.shared.getActivities();
            //get current DESIGNS UPDATED
            //console.log(data);
        });
    }

    self.startActivityDesign = function (design, sesid) {
        //change it to do it for the first stage or a selected stage?
        var stageCounter = 0
        for(var phase of design.phases){
        
        var postdata = {
            number: stageCounter + 1,
            question: "",
            grouping: null,
            type: phase.mode,
            anon: phase.anonymous,
            chat: phase.chat,
            sesid: sesid,
            prev_ans: ""
        };
        console.log(postdata)

        $http({url: "add-stage", method: "post", data: postdata}).success(function (data) {
            let stageid = data.id;
            if (stageid != null) {
                /*
                if (postdata.type == "team") {
                    self.acceptGroups(stageid);
                }
                */
               console.log("TYPE:",self.selectedSes.type)
                if (self.selectedSes.type == "T" || true) {
                    var counter = 1;
                    for(var question of phase.questions){
                        var content = question.ans_format
                        let p = {
                            name: question.q_text,
                            tleft: content.l_pole,
                            tright: content.r_pole,
                            num: content.values,
                            orden: counter,
                            justify: content.just_required,
                            stageid: stageid,
                            sesid: sesid,
                            word_count: content.min_just_length
                        };
                        console.log(p)
                        $http({url: "add-differential-stage", method: "post", data: p}).success(function (data) {

                            let pp = {sesid: sesid, stageid: stageid};
                            $http({url: "session-start-stage", method: "post", data: pp}).success(function (data) {
                                //sql: "update sessions set status = 2, current_stage = $1 where id = $2",
                                Notification.success("Etapa creada correctamente");
                                //window.location.reload()
                            });
                            
                        });
                        counter++;
                    }
                }

                
            }
            else {
                Notification.error("Error al crear la etapa");
            }
        });
    
        stageCounter++;
        break;
        }
    };




    self.generateCodeActivity = function (ID) { //use it to generate the code
        var postdata = {
            id: ID
        };
        $http.post("generate-session-code", postdata).success(function (data) {
            if (data.code != null) self.selectedSes.code = data.code;
        });
    };

    self.currentActivities = function(type){
        if(type == 0) return self.activities.filter(function(activity) {return activity.status != 3 && activity.archived ==false;});
        if(type == 1) return self.activities.filter(function(activity) {return activity.status == 3 && activity.archived ==false;;});
        if(type == 2) return self.activities.filter(function(activity) {return activity.archived;});
    }

    self.designSelected = function(){
        return launchId.id
    }

    self.createCopy = function(ses){
        self.createSession(ses.name, ses.descr, ses.type, ses.dsgnid)
        self.shared.getActivities();
        self.shared.updateSesData();
        Notification.success("Actividad copiada!");
    }

    self.init();


});

adpp.controller("MonitorActivityController", function ($scope, $filter, $http, Notification, $timeout) {
    var self = $scope;


    self.init = function(){
        if(self.selectedView == "activity") {
            self.shared.resetGraphs(); // self.iterationIndicator  fix this id
            self.currentStage();
            }
    }

    self.nextActivityDesign = function () {
        var stageCounter = self.currentActivity.stage + 1
        var sesid = self.selectedSes.id
        console.log("Current design:",self.design)
        console.log("Current stage:",stageCounter)
        console.log("Current sesid:",sesid)
       
        var current_phase = self.design.phases[stageCounter]
        console.log("NEXT PHASE:", current_phase)


        var postdata = {
            number: stageCounter + 1,
            question: "",
            grouping: null,
            type: current_phase.mode,
            anon: current_phase.anonymous,
            chat: current_phase.chat,
            sesid: sesid,
            prev_ans: ""
        };
        console.log(postdata)
        
        $http({url: "add-stage", method: "post", data: postdata}).success(function (data) {
            let stageid = data.id;
            if (stageid != null) {
      
                if (postdata.type == "team") {
                    self.acceptGroups(stageid);
                }

               console.log("TYPE:",self.selectedSes.type)
                if (self.selectedSes.type == "T" || true) {
                    var counter = 1;
                    for(var question of current_phase.questions){
                        var content = question.ans_format
                        let p = {
                            name: question.q_text,
                            tleft: content.l_pole,
                            tright: content.r_pole,
                            num: content.values,
                            orden: counter,
                            justify: content.just_required,
                            stageid: stageid,
                            sesid: sesid,
                            word_count: content.min_just_length
                        };
                        console.log(p)
                        $http({url: "add-differential-stage", method: "post", data: p}).success(function (data) {
                            
                        });
                        counter++;
                    }
                }
                let pp = {sesid: sesid, stageid: stageid};
                $http({url: "session-start-stage", method: "post", data: pp}).success(function (data) {
                    Notification.success("Etapa creada correctamente");
                    //window.location.reload()

                    //call request to change activity currentstage <-----------------------------------------
                });
                
            }
            else {
                Notification.error("Error al crear la etapa");
            }
        });
   
    };

    self.currentStage = function () {
        var pd = {
            sesid: self.selectedSes.id
        };
        $http({ url: "get-current-stage", method: "post", data: pd }).success(function (data) {
            console.log(data)
            self.currentActivity.stage = data[0].number -1;
        });
    };

    self.finishActivity = function(){
        $http.post("session-finish-stages", {sesid: self.selectedSes.id}).success((data) => {
            console.log(data);
            window.location.reload();
        });
    }

    self.init();


});

adpp.controller("BrowseDesignsController", function ($scope, $filter, $http, Notification, $timeout) {
    var self = $scope;
    self.designs = null;
    self.public = null;

    self.init = function(){
        if(self.selectedView == "launchActivity") {self.getDesigns(); } //make request when on launchActivity view only
        else if(self.selectedView == "designs") {self.getDesigns();} 
        if(self.selectedView == "designs") {self.getPublicDesigns(); } 
    }

    self.designPublic = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({ url: "design-public", method: "post", data: postdata }).success(function (data) {

        });
    };

    self.designLock = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({ url: "design-lock", method: "post", data: postdata }).success(function (data) {
  
        });
    };

    self.getDesigns = function(){
        $http.get("get-user-designs").success(function (data) {
            
            if (data.status == "ok") {
                self.designs = data.result;
            }
            
        });
    };

    self.getPublicDesigns = function(){
        $http.get("get-public-designs").success(function (data) {
            
            if (data.status == "ok") {
                self.public = data.result;
            }
            
        });
    };

    self.deleteDesign = function (ID) {
        var postdata = {"id": ID};
        $http.post("delete-design", postdata).success(function (data) {
            
            if (data.status == "ok") {
                self.getDesigns(); //get current Designs 
            }
            
        });

    }


    self.getDesign = function (ID) {
        $http.post("get-design", ID).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result)

            }
        });
    };

    self.goToDesign = function(ID, type){
        $http.post("get-design", ID).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result)
                if(type=="E") self.selectView("newDesignExt")
                else self.selectView("viewDesign")
                designId.id = ID;

            }
        });        
    }

    self.launchDesignEdit = function(){
        launchId.id = designId.id;
        self.selectView("launchActivity");
    }

    self.launchDesign = function(ID){
        launchId.id = ID;
        self.selectView("launchActivity");
    }

    self.init();

});


adpp.controller("StagesEditController", function ($scope, $filter, $http, Notification, $timeout) {

    var self = $scope;


    self.keyGroups = function (k1, k2) {
        return {
            key: k1 + (k2 == null ? "" : " " + k2),
            name: k1 + (k2 == null ? "" : " " + k2)
            //name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2)) FIX TRANSLATION BUG
        };
    };

    self.currentStage = 0; //index of stage
    self.currentQuestion = 0; //index of current question
    self.methods = [self.keyGroups("random"), self.keyGroups("performance", "homog"), self.keyGroups("performance", "heterg"), 
                    self.keyGroups("knowledgeType", "homog"), self.keyGroups("knowledgeType", "heterg")];
    self.groupType = [self.keyGroups("individual"), self.keyGroups("team")];
    self.busy = false; //upload file
    self.extraOpts = false;
    self.documents = null;
    self.prevStages = false;
    //self.design = {};
    /*
    self.design = { //DUMMY DATA
        "metainfo":{
            "title":" Test Design",
            "author": "Claudio Alvarez",
            "creation_date": "",
            "id":"HsLKs92M"
        },
        "roles":[],
        "type":"semantic_differential",
        "phases":[
            {
                "mode":"individual",
                "chat":true,
                "anonymous":true,
                "grouping_algorithm" : "random",
                "prevPhasesResponse" : [ ],
                "stdntAmount":3,
                "questions":[
                    {
                    "q_text":"Te gusta como esta quedando el formato?",
                    "ans_format":{
                        "values":7,
                        "l_pole":"Me carga",
                        "r_pole":"Me encanta",
                        "just_required": true,
                        "min_just_length": 5
                    }
                    },
                    {
                    "q_text":"Testing",
                    "ans_format":{
                        "values":9,
                        "l_pole":"Me carga",
                        "r_pole":"Me encanta",
                        "just_required": false,
                        "min_just_length": 8
                    }
                    }
                ]
            },
            {
            "mode":"team",
            "chat":false,
            "anonymous":true,
            "grouping_algorithm" : "knowledgeType homog",
            "prevPhaseResponse" : [ 0],
            "stdntAmount":4,
            "questions":[
                {
                    "q_text":"Pregunta de prueba",
                    "ans_format":{
                        "values":10,
                        "l_pole":"En contra",
                        "r_pole":"A favor",
                        "just_required": false,
                        "min_just_length": 8
                }
                },
                {
                "q_text":"Te gusta como esta quedando el formato?",
                "ans_format":{
                    "values":7,
                    "l_pole":"Me carga",
                    "r_pole":"Me encanta",
                    "just_required": true,
                    "min_just_length": 5
                }
                }
            ]
        },
        {
            "mode":"team",
            "chat":false,
            "anonymous":false,
            "grouping_algorithm" : "performance homog",
            "prevPhaseResponse" : [ 0 ,1],
            "stdntAmount":7,
            "questions":[
                {
                    "q_text":"Tercera fase",
                    "ans_format":{
                        "values":4,
                        "l_pole":"En contra",
                        "r_pole":"A favor",
                        "just_required": false,
                        "min_just_length": 8
                }
                },
                {
                "q_text":"Te gusta como esta quedando el formato?",
                "ans_format":{
                    "values":9,
                    "l_pole":"Me carga",
                    "r_pole":"Me encanta",
                    "just_required": true,
                    "min_just_length": 5
                }
                }
            ]
        }
        ]

    }
    */
    /*

        MOVER CONTENIDO A CONTROLADORES CORRESPONDIENTES!

    */

    /*
        BACKEND FUNCTIONS
    */

    

    self.init = function(){
        //resetValues();
        if(self.selectedView == "newDesign") self.changeDesign(null)
        if(self.design != null){
            self.stageType = self.design.type;
            self.num = self.design.phases[0].questions[0].ans_format.values
            resetValues();
        }
    }
  
    self.uploadDesign = function (title, author) {
        var postdata = { 
            "metainfo":{
                "title":title,
                "author": author,
                "creation_date": Date.now()
            },
            "roles":[],
            "type":"semantic_differential",
            "phases":[
                {
                    "mode":"individual",
                    "chat":true,
                    "anonymous":true,
                    "grouping_algorithm" : "random",
                    "prevPhasesResponse" : [ ],
                    "stdntAmount":3,
                    "questions":[
                        {
                        "q_text":"",
                        "ans_format":{
                            "values":7,
                            "l_pole":"",
                            "r_pole":"",
                            "just_required": true,
                            "min_just_length": 5
                        }
                    }
                    ]
                }
            ]
            }
        $http.post("upload-design", postdata).success(function (data) {
            
            if (data.status == "ok") {
                self.getDesign(data.id);
            }
        });
        
    };

    self.updateDesign = function () {
        var postdata = {"design":self.design,"id": designId.id};
        $http.post("update-design", postdata).success(function (data) {
            
            if (data.status == "ok") {
                //console.log(data)
            }
            
        });

    }


    self.getDesign = function (ID) {
        $http.post("get-design", ID).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result)
                designId.id = ID; //use variable from admin later
                self.selectView("newDesignExt");
            }
        });
    };


    self.getID = function(){
        return designId.id;
    }

    var resetValues = function(){
        // RESET VALUES
        self.currentStage = 0; 
        self.currentQuestion = 0; 
        self.stageType = self.design.type;
        self.design.phases[0].questions[0].ans_format.values
        self.busy = false; 
        self.extraOpts = false;
        self.prevStages = false;
    }

    /*
        FRONTEND FUNCTIONS
    */

    self.toggleOpts = function(opt){
        if(opt == 1)self.extraOpts = !self.extraOpts;
        else if(opt == 2) self.prevStages = !self.prevStages;
        
    }

    self.buildArray = function (n) {
        var a = [];
        for (var i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };
    
    self.selectQuestion = function(id){
        self.currentQuestion = id; 
        self.num = self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format.values
    }

    self.addQuestion = function(){
        self.design.phases[self.currentStage].questions.push(
            {
            "q_text":"",
            "ans_format":{
                "values":5,
                "l_pole":"",
                "r_pole":"",
                "just_required": true,
                "min_just_length": 10
        }})
        self.selectQuestion(self.design.phases[self.currentStage].questions.length-1) //send to new question
    }

    self.deleteQuestion = function(index){
        if(self.currentQuestion != null && self.design.phases[self.currentStage].questions.length != 1){
            //change question index
            if(index == 0) self.currentQuestion = 0;
            else if(index < self.design.phases[self.currentStage].questions.length-1) self.currentQuestion = self.currentQuestion;
            else self.currentQuestion = self.currentQuestion -1;
            self.design.phases[self.currentStage].questions.splice(index, 1);
            self.selectQuestion(self.currentQuestion );
        }
    }

    self.selectStage = function(id){
        if(self.currentStage != id){
            self.currentStage = id;
            self.stageType = self.design.type;
            self.currentQuestion = 0 //reset question index
            self.num = self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format.values;
        }
        else {
            /*
            self.currentStage = null; //unselect current stage
            self.num = null;
            self.stageType  = null;
            */
        }
        self.extraOpts = false;
        self.prevStages = false;
        //console.log(self.methods);
    }

    self.deleteStage = function(){
        if(self.currentStage != null && self.design.phases.length != 1){
            var index = self.currentStage
            self.design.phases.splice(index, 1);
            self.currentQuestion = 0 //reset question index
            self.num = null;
            self.currentStage = null;
            self.extraOpts = false;
            self.prevStages = false;
        }
    }

    self.templateStage = function(type){ 
        // UNUSED
        return {
            "mode":"individual",
            "chat":false,
            "anonymous":false,
            "questions":[
                {
                    "q_text":"",
                    "ans_format":{
                        "values":5,
                        "l_pole":"",
                        "r_pole":"",
                        "just_required": false,
                        "min_just_length": 8
                }
                }
            ]
        }
    }
    
    self.copyPrevStage = function(type, prevphase){
        var phase = JSON.parse(JSON.stringify(prevphase)); //removes reference from previous object
        return {
            "mode":phase.mode,
            "chat":phase.chat,
            "anonymous":phase.anonymous,
            "questions":phase.questions,
            "grouping_algorithm": phase.grouping_algorithm,
            "prevPhaseResponse": phase.prevPhaseResponse,
            "stdntAmount": phase.stdntAmount
        }
    }

    self.addStage = function(){
        var index = self.design.phases.length -1
        var prev_phase = self.design.phases[index]
        self.design.phases.push(self.copyPrevStage("semantic_differential", prev_phase))
    }

    self.getStages = function(){
        return self.design.phases
    }

    self.amountOptions = function(type){
        self.num = self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format.values
        if(type == "+"){
            self.num = self.num < 9 ? self.num + 1 : 10
        }
        else{
            self.num = self.num > 2 ? self.num - 1 : 2
        }
        self.design.phases[self.currentStage].questions[self.currentQuestion].ans_format.values = self.num
    }

    self.init() //init

});


adpp.controller("OptionsController", function ($scope, $http, Notification) {
    var self = $scope;
    self.conf = {};
    self.sesidConfig = -1;
    self.options = [{ name: "optCom", code: "J" }, { name: "optConfLv", code: "C" }, { name: "optHint", code: "H" }];

    self.saveConfs = function () {
        var postdata = {
            sesid: self.selectedSes.id,
            options: self.buildConfStr()
        };
        $http.post("update-ses-options", postdata).success(function (data) {
            if (data.status == "ok") {
                Notification.success("Opciones actualizadas");
                self.selectedSes.options = postdata.options;
                self.selectedSes.conf = null;
                self.shared.updateConf();
            }
        });
    };

    self.shared.saveConfs = self.saveConfs;

    self.shared.updateConf = function () {
        if (self.selectedSes.conf == null) {
            self.selectedSes.conf = {};
            var op = self.selectedSes.options || "";
            for (var i = 0; i < op.length; i++) {
                self.selectedSes.conf[op[i]] = true;
            }
            console.log(self.selectedSes);
        }
        return true;
    };

    self.buildConfStr = function () {
        var s = "";
        for (var key in self.selectedSes.conf) {
            if (self.selectedSes.conf[key]) s += key;
        }
        return s;
    };
});

adpp.controller("DashboardRubricaController", function ($scope, $http) {
    var self = $scope;
    self.reports = [];
    self.result = [];
    self.selectedReport = null;

    self.shared.resetRubricaGraphs = function () {
        self.alumState = null;
        self.barOpts = {
            chart: {
                type: 'multiBarChart',
                height: 320,
                x: function x(d) {
                    return d.label;
                },
                y: function y(d) {
                    return d.value;
                },
                showControls: false,
                showValues: false,
                duration: 500,
                xAxis: {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: 'Cantidad Alumnos'
                }
            }
        };
        self.barData = [{ key: "Alumnos", color: "#ef6c00", values: [] }];
        //self.updateGraph();
    };

    self.shared.resetRubricaGraphs();
});


adpp.controller("StagesController", ["$scope", "$http", "Notification", "$uibModal", window.StagesController]);

adpp.filter('htmlExtractText', function () {
    return function (text) {
        return text ? String(text).replace(/<[^>]+>/gm, '') : '';
    };
});

adpp.filter("trustHtml", ["$sce", function ($sce) {
    return function (html) {
        return $sce.trustAsHtml(html);
    };
}]);

adpp.filter('lang', function () {
    filt.$stateful = true;
    return filt;

    function filt(label) {
        if (window.DIC == null) return;
        if (window.DIC[label]) return window.DIC[label];
        if (!window.warnDIC[label]) {
            console.warn("Cannot find translation for ", label);
            window.warnDIC[label] = true;
        }
        return label;
    }
});

var generateTeams = function generateTeams(alumArr, scFun, n, different, double) {
    if (n == null || n == 0) return [];
    console.log(alumArr);
    var arr = alumArr;
    if(!double) {
        arr.sort(function (a, b) {
            return scFun(b) - scFun(a);
        });
    }
    else{
        arr.sort(scFun);
    }
    var groups = [];
    var numGroups = alumArr.length / n;
    for (var i = 0; i < numGroups; i++) {
        if (different) {
            (function () {
                var rnd = [];
                var offset = arr.length / n;
                for (var j = 0; j < n; j++) {
                    rnd.push(~~(Math.random() * offset + offset * j));
                }
                groups.push(arr.filter(function (a, i) {
                    return rnd.includes(i);
                }));
                arr = arr.filter(function (a, i) {
                    return !rnd.includes(i);
                });
            })();
        } else {
            groups.push(arr.filter(function (a, i) {
                return i < n;
            }));
            arr = arr.filter(function (a, i) {
                return i >= n;
            });
        }
    }
    var final_groups = [];
    var ov = 0;
    for (var _i = 0; _i < groups.length; _i++) {
        if (groups[_i].length > 1 || final_groups.length == 0) {
            final_groups.push(groups[_i]);
        }
        else {
            final_groups[ov % final_groups.length].push(groups[_i][0]);
            ov++;
        }
    }
    return final_groups;
};

var isDifferent = function isDifferent(type) {
    switch (type) {
        case "performance homog":
            return false;
        case "performance heterg":
            return true;
        case "knowledgeType homog":
            return false;
        case "knowledgeType heterg":
            return true;
    }
    return false;
};

var habMetric = function habMetric(u) {
    switch (u.aprendizaje) {
        case "Teorico":
            return -2;
        case "Reflexivo":
            return -1;
        case "Activo":
            return 1;
        case "Pragmatico":
            return 2;
    }
    return 0;
};

var quillMapHandler = function quillMapHandler() {
    alert("Mapa sólo disponible para preguntas");
};


adpp.controller("instituciones",["$scope",'$http',function($scope,$http,Admin){
    var self = $scope;
    self.uid = [];
    self.domains =[];
    self.role = "";
    self.id = 0;
    self.mail = "";
    self.nominst = "";
    self.users = [];
    self.textarea = "";
    self.institutionid = "";
    self.init = function () {
        self.getuserinfo();
        self.getdomains(); 
    };


    self.user_amount = function () {
        if(self.textarea.split("\n").length == 1){
            if(self.textarea.length == 0){
                return 0
            }
            else{
                return 1
            }
            
        }
        else{
            return self.textarea.split("\n").length
        }
        
    };

    self.getuserinfo = function() {
        var postdata = 500
        $http({ url: "getuserinfo", method: "post",data:postdata }).success(function (data) {
            self.uid = data.data[0].id;
            self.lang = data.data[0].lang;
            self.mail = data.data[0].mail;
            self.role = data.data[0].role
            self.username = data.data[0].name
        });
    }

    self.getdomains = function() {
        var postdata = 404;
        $http({ url: "getdomains", method: "post",data:postdata }).success(function (data) {
            self.domains = data.data[0].mailDomains;
            self.institutionid = data.data[0].id
            self.nominst = data.data[0].institutionName;
            $http({ url: "get_mail_domains", method: "post",data:self.institutionid }).success(function (data) {
                var postdata2 = data.data
                $http({ url: "get_same_users", method: "post", data: {postdata2} }).success(function (data) {
                    var res = []
                    data.data.forEach(element =>{
                        
                            res.push(element)
    
                        })
                    
                    self.users = [];
                    self.users = res;
                    
    
                });

            })
            

        });
    }


    self.refreshUsers = function () {
        var postdata2 = self.domains

        $http({ url: "get_mail_domains", method: "post",data:self.institutionid }).success(function (data) {
            var postdata2 = data.data
            $http({ url: "get_same_users", method: "post", data: {postdata2} }).success(function (data) {
                var res = []
                data.data.forEach(element =>{
                    
                        res.push(element)

                    })
                
                self.users = [];
                self.users = res;
                

            });

        })
        
    };


    
    self.init();
}])


adpp.controller("no_account",["$scope",'$http',function($scope,$http,Admin){
    var self = $scope;
    const lang = navigator.language
    if(lang[0] == 'e' && lang[1] == 's'){
        self.lang = "spanish";
    }
    else{
        self.lang = "english";
    }



    window.DIC = "data/" + self.lang + ".json";


    self.init = function () {
        self.updateLang(self.lang);
        self.getcountries();
    };

    self.activate_user = function(){
        var url_string = window.location;
        var url = new URL(url_string);
        var rc = url.searchParams.get("rc");
        var token = url.searchParams.get("tok");
        console.log(token)
        $http({ url: "activate_user", method: "post",data:{token} }).success(function (data) {
        });
    }

    self.getcountries = function(){
        $http.get("https://restcountries.com/v3.1/all").success(function (data) {
            var list = []
            
            for(var i = 0;i< data.length;i++){ 
                list.push(data[i].name.common)
            }
            list.sort()
            if(lang[0] == 'e' && lang[1] == 's'){
                list.unshift("Elige un Pais")
            }
            else{
                list.unshift("Choose Country")
            }
            
            self.countries = list;
            
        });
    }



    self.updateLang = function (lang) {
        $http.get("data/" + lang + ".json").success(function (data) {
            window.DIC = data;
        });
    };

    self.changeLang = function () {
        self.lang = self.lang == "english" ? "spanish" : "english";
        self.updateLang(self.lang);
    };



    self.init();

}])


adpp.controller("super_admin",["$scope",'$http',"$uibModal",function($scope,$http,$uibModal,Admin){
    var self = $scope;
    self.accepted = [];
    self.pending = [];
    self.institutions = [];
    self.accepted_institutions = [];
    self.users = [];

    self.temp_intitution_name = "";
    self.temp_intitution_country = "";
    self.temp_admin_name = "";
    self.temp_admin_mail = "";
    self.temp_admin_position = "";
    self.temp_inst_domains = "";
    self.temp_admin_id = "";
    self.temp_instutionid ="";

    self.intitution_name = "";
    self.intitution_country = "";
    self.admin_name = "";
    self.admin_mail = "";
    self.admin_position = "";
    self.inst_domains = "";
    self.admin_id = "";
    self.instutionid ="";

    self.init = function () {
        self.get_temporary_institutions();
        self.get_institutions();
        self.get_institution_info();
        self.getdomains()
    };

    self.get_temporary_institutions = function() {
        var postdata = 500
        $http({ url: "get_temporary_institutions", method: "post",data:postdata }).success(function (data) {
            var inst = [];
            if(data != null && data != undefined){
                for(var i = 0;i < data.data.rows.length ;i++){
                    inst.push(data.data.rows[i])
                }
                self.institutions = inst;
            }

        });
    }

    self.get_institutions = function() {
        var postdata = 500
        $http({ url: "get_institutions", method: "post",data:postdata }).success(function (data) {
            var inst = [];
            if(data != null && data != undefined){
                for(var i = 0;i < data.data.rows.length ;i++){
                    inst.push(data.data.rows[i])
                }
                self.accepted_institutions = inst;
            }

        });
    }





    self.get_institution_info = function () {
        var inst_id = self.inst_id
        
        if(self.inst_id != 0){
            $http({ url: "get_institution_info", method: "post", data: {inst_id} }).success(function (data) {

                if(data != null && data != undefined && data.data.rows.length > 0){

                    self.intitution_name = data.data.rows[0].institution_name;
                    self.intitution_country = data.data.rows[0].country;
                    self.admin_id = data.data.rows[0].userid;
                    self.admin_position = data.data.rows[0].position;


                    self.instutionid = data.data.rows[0].id
                    var userid = self.admin_id;
                    $http({ url: "get_admin_info", method: "post", data: {userid} }).success(function (data) {
                        if(data != null && data != undefined && data.data.rows.length > 0){
                            self.admin_name = data.data.rows[0].name;
                            self.admin_mail = data.data.rows[0].mail;
        
                        }


                    });
                    var institutuinid = self.instutionid;
                    $http({ url: "get_institution_domains", method: "post", data: {institutuinid} }).success(function (data) {
                        if(data != null && data != undefined && data.data.rows.length > 0){
                            
                            var lista = ""

                            for(var i = 0;i < data.data.rows.length;i++){
                                lista += data.data.rows[i].domain_name+"\n"
                            }
                            self.inst_domains = lista;        
                        }


                    });
                }
                if(self.inst_id != 0){
                    $http({ url: "get_temp_institution_info", method: "post", data: {inst_id} }).success(function (data) {
        
                        if(data != null && data != undefined && data.data.rows.length > 0){
                            self.temp_intitution_name = data.data.rows[0].institution_name;
                            self.temp_intitution_country = data.data.rows[0].country;
                            self.temp_admin_id = data.data.rows[0].userid;
                            self.temp_admin_position = data.data.rows[0].position;
                            var domains = data.data.rows[0].mail_domains.split(",");
                            var lista = "";
                            for (var i = 0; i < domains.length;i++){
                                lista+=domains[i]+"\n"
            
                            }
                            self.temp_inst_domains = lista;
                            self.temp_instutionid = data.data.rows[0].id
                            var userid = self.temp_admin_id;
                            $http({ url: "get_temp_admin_info", method: "post", data: {userid} }).success(function (data) {
                                if(data != null){
                                    self.temp_admin_name = data.data.rows[0].name;
                                    self.temp_admin_mail = data.data.rows[0].mail;
                
                                }
                            });
                        }
                    });
                } 
            });
        }   
 
    };


    self.acceptmodal = function () {
        $uibModal.open({
            template: '<div style="height: fit-content;"><div class="modal-header"><h4>Alerta</h4></div><div style="height: 75px; class="modal-body">' +
                '<p>\tEsta seguro que desea aceptar a esta institucion?</p>' +
                '<form action="accept_institution" method="POST">'+
                '<input  name="userid" type="hidden" value="'+self.temp_admin_id+'" class="form-control profile-input"> <input  name="institutionid" type="hidden" value="'+self.temp_instutionid+'" class="form-control profile-input">'+
                '<button class="btn-primary btn modal-buttons"> Aceptar</button> </form></div> </div>'
        });

    }

    self.rejectmodal= function () {
        $uibModal.open({
            template: '<div style="height: fit-content;"><div class="modal-header"><h4>Alerta</h4></div><div style="height: 75px; class="modal-body">' +
                '<p>\tEsta seguro que desea rechazar a esta institucion?</p>'+
                '<form action="reject_institution" method="POST"> '+
                '<input  name="userid" type="hidden" value="'+self.temp_admin_id+'" class="form-control profile-input"> <input  name="institutionid" type="hidden" value="'+self.temp_instutionid+'" class="form-control profile-input">'+
                '<button class="btn-primary btn modal-buttons" style="background-color: red;"> Rechazar</button> </form> </div> </div>'
        });
    }

    self.getdomains = function() {
        var postdata = 404;
        $http({ url: "get_all_users", method: "post",data:postdata }).success(function (data) {
            var res = []
            data.data.rows.forEach(element =>{       
                res.push(element)
            })
            self.users = [];
            self.users = res;
            

        });
    }
    self.refreshUsers = function () {
        var postdata2 = self.domains

        $http({ url: "get_all_users", method: "post",data:postdata }).success(function (data) {
            var res = []
            data.data.forEach(element =>{       
                res.push(element)
            })
            self.users = [];
            self.users = res;
            

        });
        
    };






    self.init();
}])