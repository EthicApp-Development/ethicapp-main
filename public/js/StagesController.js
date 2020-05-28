window.StagesController = function($scope, $http, Notification){
    var self = $scope;

    self.stages = [];
    console.log(self.flang);

    var klg = function klg(k1, k2) {
        return {
            key: k1 + (k2 == null ? "" : " " + k2),
            name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2))
        };
    };

    self.methods = [klg("random"), klg("performance", "homog"), klg("performance", "heterg"), klg("knowledgeType", "homog"), klg("knowledgeType", "heterg")];


    self.stage = {
        type: null,
        anon: false,
        chat: false,
        prevResponses: []
    };

    self.stageRoles = [];

    self.roles = [];

    self.currentStage = -1;

    self.setCurrentStage = function(i){
        self.currentStage = i;
    };

    self.getStages = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        $http({ url: "get-admin-stages", method: "post", data: postdata }).success(function (data) {
            self.stages = data;
        });
    };

    self.changeStage = function(i){
        self.currentStage = i;
    };

    self.addRole = function(){
        self.roles.push({
            name: "",
            type: "order"
        });
    };

    self.setAllRolesType = function(type){
        for (let i = 0; i < self.roles.length; i++) {
            self.roles[i].type = type;
        }
    };

    self.removeRole = function (index) {
        self.roles.splice(index, 1);
    };

    self.sendStage = function(){
        var s = self.stage;
        if(s.type == null || self.roles.length == 0){
            Notification.error("Hay datos faltantes");
            return;
        }
        var postdata = {
            number: self.stages.length + 1,
            type: s.type,
            anon: s.anon,
            chat: s.chat,
            sesid: self.selectedSes.id,
            prev_ans: s.prevResponses.join(",")
        };
        $http({ url: "add-stage", method: "post", data: postdata }).success(function (data) {
            let stageid = data.id;
            if(stageid != null) {
                let c = self.roles.length;
                for (let i = 0; i < self.roles.length; i++) {
                    const role = self.roles[i];
                    let p = {
                        name: role.name,
                        jorder: role.type == "order",
                        stageid: stageid,
                    };
                    $http({ url: "add-actor", method: "post", data: p }).success(function (data) {
                        console.log("Actor added");
                        c -= 1;
                        if(c == 0){
                            let pp = {sesid: self.selectedSes.id, stageid: stageid};
                            $http({ url: "session-start-stage", method: "post", data: pp }).success(function (data) {
                                Notification.success("Etapa creada correctamente");
                                self.getStages();
                            });
                        }
                    });
                }
            }
            else {
                Notification.error("Error al crear la etapa");
            }
        });
    };

    self.getStages();

};
