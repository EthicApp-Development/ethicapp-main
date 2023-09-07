/*eslint func-style: ["error", "expression"]*/
export let DashboardRubricaController = ($scope) => {
    var self = $scope;
    self.reports = [];
    self.result = [];
    self.selectedReport = null;

    self.shared.resetRubricaGraphs = function () {
        self.alumState = null;
        self.barOpts = {
            chart: {
                type:   "multiBarChart",
                height: 320,
                x:      function x(d) {
                    return d.label;
                },
                y: function y(d) {
                    return d.value;
                },
                showControls: false,
                showValues:   false,
                duration:     500,
                xAxis:        {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: "Cantidad Alumnos"
                }
            }
        };
        self.barData = [{ key: "Alumnos", color: "#ef6c00", values: [] }];
        //self.updateGraph();
    };

    self.shared.resetRubricaGraphs();
};