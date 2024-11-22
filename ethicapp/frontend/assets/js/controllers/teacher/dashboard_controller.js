import { TeacherRouter } from "../../modules/teacher/teacher-routes";
import { ActivityCatalogService } from "../../services/activity-catalog-service";

/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $http, 
    $timeout, $uibModal, ActivityStateService, ActivityCatalogService, 
    DesignCatalogService, $translate) {

    const vm = this;
    vm.designObj = null;
    vm.userList = [];

    // Inicialización del controlador
    vm.init = async function () {
        let id = $routeParams.id;
        console.log(`[DashboardController::init] ${id}`);

        if (!id || isNaN(Number(id))) {
            $scope.navigateTo("/error/404/2");
            return; 
        }

        // Display the info tab by default
        vm.activeTab = 'info';

        // Session Id for this instance
        vm.sessionId = Number(id);

        // Get the activity descriptor
        vm.activityDescriptor = await ActivityCatalogService.getActivityBySessionId(vm.sessionId);

        $translate('activity_details_dashboard_title').then((translation) => {
            vm.activityTitle = translation;
        }).catch((error) => {
            console.error('Translation error:', error);
        });

        vm.activityStateDescriptor = await ActivityStateService.getActivityState(vm.sessionId, true);

        vm.isActivityFinished = false;

        console.debug(`[DashboardController::init] ${JSON.stringify(vm.activityDescriptor)}`);

        // Mock de usuarios conectados
        vm.users = [
            { name: 'Juan Pérez', mail: 'juan.perez@example.com', role: 'Administrador', device: 'Desktop' },
            { name: 'María López', mail: 'maria.lopez@example.com', role: 'Usuario', device: 'Mobile' },
            { name: 'Carlos Martínez', mail: 'carlos.martinez@example.com', role: 'Moderador', device: 'Tablet' }
        ];

        // Mock de fases del diseño
        vm.designPhases = [
            { name: 'Fase 1: Análisis', description: 'Recopilación de requisitos y análisis del proyecto.', status: 'Completada' },
            { name: 'Fase 2: Diseño', description: 'Diseño conceptual y técnico del sistema.', status: 'En Progreso' },
            { name: 'Fase 3: Implementación', description: 'Desarrollo del sistema y pruebas iniciales.', status: 'Pendiente' },
            { name: 'Fase 4: Validación', description: 'Pruebas finales y aceptación del cliente.', status: 'Pendiente' }
        ];

    };

    // Método para actualizar contenido (mock)
    vm.updateContent = function (data) {
        console.log('Contenido actualizado:', data);
        // Aquí podrías agregar lógica para actualizar datos en la vista
    };

    vm.init2 = async function () {
        let id = $routeParams.id;
        console.log(`[DashboardController::init] ${id}`);

        if (!id || isNaN(Number(id))) {
            $scope.navigateTo("/error/404/2");
            return; 
        }

        // Session Id for this instance
        vm.sessionId = Number(id);

        // Retrieve the state of the activity
       /*try {
            const activityState = await ActivityStateService.getActivityState(vm.sessionId, true);
            vm.design = activityState.design; // Design of the activity
            vm.phases = activityState.phases; // Actual phases that have been created, with their state    
        } catch (error) {
            console.error(`Could not load the state of the activity with id ${vm.sessionId}`);
        }*/

        vm.designObj = {};
        vm.phases = [{ name: "Phase 1", description: "Test", status: "Finished"},
            { name: "Phase 2", description: "Test", status: "In progress"}];
    };

    vm.startNextPhase = function() {
        console.log('Starting next phase...');
    };

    vm.endActivity = function() {
        console.log('Ending activity...');
        vm.isActivityFinished = true; // Update the state to finished
    };

    vm.downloadAnswersReport = function() {
        console.log('Downloading answers report...');
    };

    vm.downloadChatLog = function() {
        console.log('Downloading chat log...');
    };    

    vm.init();
};