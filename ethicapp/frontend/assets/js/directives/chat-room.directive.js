function ChatRoomController($scope) {
    var $ctrl = this;
  
    $ctrl.messages = [];
    $ctrl.newMessage = '';
  
    $ctrl.$onInit = function() {
      console.log('ChatRoomDirective initialized with phaseId:', $ctrl.phaseId, 'and questionId:', $ctrl.questionId);
  
      $ctrl.messages = [
        { user: 'Estudiante', text: 'Hola, tengo una duda.' },
        { user: 'Tutor', text: 'Claro, ¿en qué puedo ayudarte?' }
      ];
    };
  
    $ctrl.sendMessage = function() {
      if ($ctrl.newMessage.trim() !== '') {
        $ctrl.messages.push({ user: 'Estudiante', text: $ctrl.newMessage });
        $ctrl.newMessage = '';
      }
    };
}

export const chatRoomDirective = function() {
    return {
      restrict: 'E',
      scope: {
        phaseId: '<',
        questionId: '<'
      },
      templateUrl: 'chatRoom.directive.html',
      controller: ChatRoomController,
      controllerAs: '$ctrl',
      bindToController: true
    };
};
