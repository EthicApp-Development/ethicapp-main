let deprecated_functions = () => {
    let self = this;

    self.flang = function (key) {
        return $filter("translate")(key);
        //return $filter("lang")(key);
    };

    self.generateCode = function () {
        var postdata = {
            id: self.selectedSes.id
        };
        $http.post("generate-session-code", postdata).success(function (data) {
            if (data.code != null) self.selectedSes.code = data.code;
        });
    };

    self.toggleSidebar = function () {
        self.openSidebar = !self.openSidebar;
        self.shared.updateState();
    };

    self.shared.resetSesId = function () {
        self.selectedId = -1;
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

    self.openViewSelected = function () { //Displays View Selected
        if(self.selectedView == "TEST"){
            $uibModal.open({
                templateUrl: "static/home.html"
            });

        }
    };

    self.openNewSes = function () {
        $uibModal.open({
            templateUrl: "static/new-ses.html"
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

    self.getNewUsers = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-new-users", method: "post", data: postdata }).success(function (data) {
            self.newUsers = data;
        });
    };

    self.requestSemDocuments = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({
            url: "semantic-documents", method: "post", data: postdata
        }).success(function (data) {
            self.semDocs = data;
        });
    };

    self.requestQuestions = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({
            url: "questions-session", method: "post", data: postdata
        }).success(function (data) {
            self.questions = data.map(function (e) {
                e.options = e.options.split("\n");
                return e;
            });
        });
        $http({
            url: "get-question-text", method: "post", data: postdata
        }).success(function (data) {
            self.questionTexts = data;
        });
    };

    self.requestDocuments = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({
            url: "documents-session", method: "post", data: postdata
        }).success(function (data) {
            self.documents = data;
        });
    };

    self.shared.updateDocuments = self.requestDocuments;

    self.deleteDocument = function (docid) {
        var postdata = { docid: docid };
        $http({ url: "delete-document", method: "post", data: postdata }).success(function () {
            self.requestDocuments();
        });
    };

    self.sesFromURL = function () {
        var sesid = $location.path().substring(1);
        var ses = self.sessions.find(function (e) {
            return e.id == sesid;
        });
        if (ses != null) self.selectSession(ses, sesid);
    };

    self.changeDesign = function(selectedDesign){
        self.design = selectedDesign;
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

    function getSession(id) {
        return self.sessions.filter(
            function(sessions){ return sessions.id == id; }
        );
    }

    self.updatelangdata = function() {
        $http({ url: "updatelangdata", method: "post", data: {lang} }).success(function (data) {
            console.log(data);

        });
    };

    self.getMe = function(){
        $http.get("is-super").success(data => {
            if(data.status == "ok"){
                self.superBar = true;
                self.super = true;
            }
        });
    };

    self.shared.updateSesData = function () {
        $http({ url: "get-session-list", method: "post" }).success(function (data) {
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

};