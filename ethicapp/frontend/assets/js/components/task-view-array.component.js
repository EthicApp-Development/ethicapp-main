function TaskViewArrayController() {
    var $ctrl = this;
  
    $ctrl.$onInit = function() {
      console.log('TaskViewArray initialized with tasks:', $ctrl.taskArray);
  
      if (!$ctrl.responses) {
        $ctrl.responses = [];
      }
    };
  
    $ctrl.submitAllResponses = function() {
      console.log('User responses submitted:', $ctrl.responses);
    };
};
  
export const taskViewArrayComponent = {
    bindings: {
      taskArray: '<',
      responses: '='
    },
    templateUrl: '/assets/static/views/student/fragments/task-view-array.template.html',
    controller: TaskViewArrayController
};
