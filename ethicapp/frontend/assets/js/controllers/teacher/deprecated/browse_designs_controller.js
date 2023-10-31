let deprecated_functions = () => {
    let self = this;
    self.getDesign = function (id) {
        $http.post("get-design", id).success(function (data) {
            if (data.status == "ok") {
                // Change current design after successful retrieval
                self.changeDesign(data.result);
            }
        });
    };

    self.goToDesign = function(id, type){
        $http.post("get-design", id).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result);
                if(type == "E") {
                    // Intended to edit the design
                    self.selectView("editDesign");
                }
                else {
                    // Intended to simply view the design
                    self.selectView("viewDesign");
                }
                DesignsService.id = id;
                console.log(DesignsService.id);
            }
        });
    };
};