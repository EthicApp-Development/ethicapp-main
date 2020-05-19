window.StagesController = function($scope, $http, Notification){
    var self = $scope;

    self.stages = [];

    self.roles = [
        { name: "Marlene", type: null },
        { name: "Barquero", type: null },
        { name: "Ermitaño", type: null },
        { name: "Pedro", type: null },
        { name: "Pablo", type: null },
    ];

    self.currentStage = 0;

    self.changeStage = function(i){
        self.currentStage = i;
    }

};
