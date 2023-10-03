/*eslint func-style: ["error", "expression"]*/
export let SuperAdminController = ($scope, $http, $uibModal) =>
{
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
        self.getdomains();
    };

    self.get_temporary_institutions = function() {
        var postdata = 500;
        $http({
            url: "get_temporary_institutions", method: "post",data: postdata
        }).success(function (data) {
            var inst = [];
            if(data != null && data != undefined){
                for(var i = 0;i < data.data.rows.length ;i++){
                    inst.push(data.data.rows[i]);
                }
                self.institutions = inst;
            }

        });
    };

    self.get_institutions = function() {
        var postdata = 500;
        $http({ url: "get_institutions", method: "post",data: postdata }).success(function (data) {
            var inst = [];
            if(data != null && data != undefined){
                for(var i = 0;i < data.data.rows.length ;i++){
                    inst.push(data.data.rows[i]);
                }
                self.accepted_institutions = inst;
            }

        });
    };

    self.get_institution_info = function () {
        var inst_id = self.inst_id;
        
        if(self.inst_id != 0){
            $http({
                url: "get_institution_info", method: "post", data: {inst_id}
            }).success(function (data) {

                if(data != null && data != undefined && data.data.rows.length > 0){

                    self.intitution_name = data.data.rows[0].institution_name;
                    self.intitution_country = data.data.rows[0].country;
                    self.admin_id = data.data.rows[0].userid;
                    self.admin_position = data.data.rows[0].position;


                    self.instutionid = data.data.rows[0].id;
                    var userid = self.admin_id;
                    $http({
                        url: "get_admin_info", method: "post", data: {userid}
                    }).success(function (data) {
                        if (data != null && data != undefined && data.data.rows.length > 0) {
                            self.admin_name = data.data.rows[0].name;
                            self.admin_mail = data.data.rows[0].mail;
                        }
                    });
                    var institutuinid = self.instutionid;
                    $http({
                        url: "get_institution_domains", method: "post", data: {institutuinid}
                    }).success(function (data) {
                        if(data != null && data != undefined && data.data.rows.length > 0){
                            
                            var lista = "";

                            for(var i = 0;i < data.data.rows.length;i++){
                                lista += data.data.rows[i].domain_name+"\n";
                            }
                            self.inst_domains = lista;        
                        }


                    });
                }
                if(self.inst_id != 0){
                    $http({
                        url: "get_temp_institution_info", method: "post", data: {inst_id}
                    }).success(function (data) {
                        if(data != null && data != undefined && data.data.rows.length > 0){
                            self.temp_intitution_name = data.data.rows[0].institution_name;
                            self.temp_intitution_country = data.data.rows[0].country;
                            self.temp_admin_id = data.data.rows[0].userid;
                            self.temp_admin_position = data.data.rows[0].position;
                            var domains = data.data.rows[0].mail_domains.split(",");
                            var lista = "";
                            for (var i = 0; i < domains.length;i++){
                                lista += domains[i] + "\n";
                            }
                            self.temp_inst_domains = lista;
                            self.temp_instutionid = data.data.rows[0].id;
                            var userid = self.temp_admin_id;
                            $http({
                                url: "get_temp_admin_info", method: "post", data: {userid}
                            }).success(function (data) {
                                if (data != null) {
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
        //! Avoid HTML in JS
        $uibModal.open({
            template: `
            <div style="height: fit-content;">
                <div class="modal-header">
                    <h4>Alerta</h4>
                </div>
                <div style="height: 75px;" class="modal-body">
                    <p>¿Está seguro que desea aceptar a esta institución?</p>
                    <form action="accept_institution" method="POST">
                        <input
                            name="userid" type="hidden" value="${self.temp_admin_id}"
                            class="form-control profile-input">
                        <input name="institutionid" type="hidden" value="${self.temp_instutionid}
                            class="form-control profile-input">
                        <button class="btn-primary btn modal-buttons">
                            Aceptar
                        </button>
                </form>
                </div>
            </div>
            `
        });

    };

    self.rejectmodal= function () {
        //! Avoid HTML in JS
        $uibModal.open({
            template: `
            <div style="height: fit-content;">
                <div class="modal-header">
                    <h4>Alerta</h4>
                </div>
                    <div style="height: 75px;" class="modal-body">
                    <p>¿Está seguro que desea rechazar a esta institución?</p>
                    <form action="reject_institution" method="POST">
                        <input name="userid" type="hidden" value="${self.temp_admin_id}"
                            class="form-control profile-input">
                        <input name="institutionid" type="hidden" value="${self.temp_instutionid}"
                            class="form-control profile-input">
                        <button class="btn-primary btn modal-buttons"
                            style="background-color: red;">
                            Rechazar
                        </button>
                    </form>
                </div>
            </div>
            `
        });
    };

    self.getdomains = function() {
        var postdata = 404;
        $http({ url: "get_all_users", method: "post",data: postdata }).success(function (data) {
            var res = [];
            data.data.rows.forEach(element =>{       
                res.push(element);
            });
            self.users = [];
            self.users = res;
            

        });
    };
    self.refreshUsers = function () {

        $http({ url: "get_all_users", method: "post",data: postdata }).success(function (data) {
            var res = [];
            data.data.forEach(element =>{       
                res.push(element);
            });
            self.users = [];
            self.users = res;
        });
    };

    self.init();
};