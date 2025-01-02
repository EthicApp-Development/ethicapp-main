import * as UAParser from 'ua-parser-js';

export function SessionsListController($scope, $http, $socket, $uibModal) {
    var self = $scope;
    self.sessions = [];
    self.sesOpen = false;
    self.invCode = "";
    self.showCodeError = false;
    self.currTab = false;
    self.sesTypeTab = false;
    self.routes = {
        L: "to-visor",
        M: "to-semantic",
        S: "to-select",
        E: "to-differential",
        R: "to-role",
        T: "to-diff",
        J: "to-role"
    };

    self.init = function () {
        self.updateSessions();
        $socket.on("stateChange", function (data) {
            self.updateSessions();
        });
        self.showName();  
    };

    self.currentSessions = function(){
        return  self.sessions.filter(self.checkStatus);
    };

    self.checkStatus = function(session){
        if(self.sesTypeTab) return session["status"] == 3;
        else return session["status"] != 3;   
    };

    self.changeTab = function(tab){
        if(tab)  self.currTab = false;        
        else self.currTab = true; 
    };

    self.changeTypeTab = function(tab){
        if(tab)  self.sesTypeTab = false;        
        else self.sesTypeTab = true; 
    };

    self.showName = function () {
        $http.post("get-my-name")
            .then(function (response) {
                // Set user information based on the response data
                self.mail = response.data.mail;
                self.rol = response.data.role;
                self.username = response.data.name;
                self.mylang = response.data.lang === "spanish" ? "es_CL" : "en_US";
                self.updateLang(self.mylang); // Update language based on user's preference
            })
            .catch(function (error) {
                console.error("Error retrieving user information:", error);
                // Optional: handle the error when fetching user data here
            });
    };
    
    self.updateSessions = function () {
        $http({ url: "get-session-list", method: "post" })
            .then(function (response) {
                // Update sessions list with the data received
                self.sessions = response.data;
            })
            .catch(function (error) {
                console.error("Error updating session list:", error);
                // Optional: handle the error when fetching session data here
            });
    };
    
    self.openSes = function () {
        self.sesOpen = true;
    };

    self.enterCode = function () {
        if (self.checkCode(self.invCode.toLowerCase())) {
            var postdata = {
                code:   self.invCode.toLowerCase(),
                device: self.getDeviceInfo()
            };
    
            $http.post("enter-session-code", postdata)
                .then(function (response) {
                    if (response.data.status === "ok") {
                        window.location.replace(response.data.redirect);
                    } else {
                        $uibModal.open({
                            template: 
                                '<div><div class="modal-header"><h4>Error</h4></div>' + 
                                '<div class="modal-body"><p>El código ingresado no es válido' +
                                " o la sesión no admite nuevos usuarios</p></div></div>"
                        });
                    }
                })
                .catch(function (error) {
                    console.error("Error en la solicitud:", error);
                    // Manejo opcional de errores adicionales
                });
        }
    };   

    self.checkCode = function (code) {
        var s = self.sessions.find(function (e) {
            return e.code == code;
        });

        if (s == null) {
            return true;
        }
        var url = self.routes[s.type] + "?sesid=" + s.id;
        window.location.replace(url);
        
        return false;
    };

    self.updateLang = function (lang) {
        $http.get("assets/locales/" + lang + ".json")
            .then(function (response) {
                // Set the global dictionary with the loaded language data
                window.DIC = response.data;
            })
            .catch(function (error) {
                console.error("Error loading language file:", error);
                // Optional: handle the error when loading the language file here
            });
    };
    
    self.changeLang = function () {
        var newlang = self.mylang === "EN_US/english" ? "es_CL" : "en_US";
        $http.post("update-lang", { lang: newlang })
            .then(function () {
                // Call showName after the language update succeeds
                self.showName();
            })
            .catch(function (error) {
                console.error("Error updating language:", error);
                // Optional: handle the error when updating the language here
            });
    };

    self.getDeviceInfo = function () {
        try {
            const parser = new UAParser.UAParser();
            const deviceType = parser.getDevice().type || "Desktop";
            const osName = parser.getOS().name || "Unknown OS";
            const browserName = parser.getBrowser().name || "Unknown Browser";
    
            return `${deviceType} / ${osName} / ${browserName}`;
        } catch (error) {
            console.error("Failed to parse device info:", error);
            return "Unknown Device / Unknown OS / Unknown Browser";
        }
    };

    self.init();
}