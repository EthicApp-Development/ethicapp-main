function TaskViewController() {
    var $ctrl = this;
  
    $ctrl.$onInit = function() {
      console.log('TaskViewComponent initialized with task:', $ctrl.task);
    };
  
    $ctrl.submitResponse = function() {
      console.log('User response submitted:', $ctrl.response);
    };
};

export const taskViewComponent = {
    bindings: {
      task: '<',
      response: '='
    },
    templateUrl: '/assets/static/views/student/fragments/task-view.template.html',
    controller: TaskViewController
};