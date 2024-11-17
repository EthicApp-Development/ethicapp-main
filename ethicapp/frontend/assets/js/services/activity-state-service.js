let ActivityStateService = ($http) => {
    const service = {
        activityStates: {},

        loadActivityState: async function(sessionId) {
            try {
                // list of connected users
                const users = await $http.get('/session/' + sessionId + '/users');

                // design used in the activity
                const designObj = await $http.get('/session/' + sessionId + '/design');

                // Phases will contain all content (i.e., question items, responses, and chat messages)
                const phases = await $http.get('/session/' + sessionId + '/phases');

                service.activityStates[sessionId] = { 
                    users: users, 
                    design: designObj,
                    phases: phases
                };

                return service.activityStates[sessionId];
            }
            catch (error) {
                console.error(`Failed to load state for session with id ${sessionId}`);
                return null;
            }
        },

        getSessionUsers: async function(sessionId, refresh = false) {
            return [];
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Activity state not found for session with id '${sessionId}'`);
            }

            if (refresh) {
                const users = await $http.get('/session/' + sessionId + '/users');
                service.activityStates[sessionId].users = users;
            }

            return service.activityStates[sessionId].users;
        },

        getActivityState: async function(sessionId, refresh = false) {
            // Mock de usuarios conectados
            const users = [
                { name: 'Juan Pérez', mail: 'juan.perez@example.com', role: 'Administrador', device: 'Desktop' },
                { name: 'María López', mail: 'maria.lopez@example.com', role: 'Usuario', device: 'Mobile' },
                { name: 'Carlos Martínez', mail: 'carlos.martinez@example.com', role: 'Moderador', device: 'Tablet' }
            ];

            // Mock de fases del diseño
            const designPhases = [
                { name: 'Fase 1: Análisis', description: 'Recopilación de requisitos y análisis del proyecto.', status: 'Completada' },
                { name: 'Fase 2: Diseño', description: 'Diseño conceptual y técnico del sistema.', status: 'En Progreso' },
                { name: 'Fase 3: Implementación', description: 'Desarrollo del sistema y pruebas iniciales.', status: 'Pendiente' },
                { name: 'Fase 4: Validación', description: 'Pruebas finales y aceptación del cliente.', status: 'Pendiente' }
            ];

            return { 
                users: users, 
                design: designPhases,
                phases: designPhases
            };

            if (refresh) {
                await service.loadActivityPhases(sessionId);
            }
            if (!(sessionId in service.activityStates)) {
                throw new Error(`Activity state not found for session with id '${sessionId}'`);
            }
            return service.activityStates[sessionId];
        },

        setSessionDescriptor: (sd) => {
            Object.keys(service.sessionDescriptor).forEach(key => {
                delete service.sessionDescriptor[key];
            });        
            Object.keys(sd).forEach(key => {
                service.sessionDescriptor[key] = sd[key];
            });
        },
        
        setDesign: (designId, designObj) => {
            service.activityDescriptor.designDescriptor.designId = designId;
            service.activityDescriptor.designDescriptor.designObject = designObj;
        },

        getDesignObj: () => {
            return service.activityDescriptor.designDescriptor.designObject;
        },

        getDesignId: () => {
            return service.activityDescriptor.designDescriptor.designId;
        },

        async loadActivityPhases() {
            const sesid = service.sessionDescriptor.id;
            console.log(`[ActivityStateService::loadActivityPhases] Starting with sesid: ${sesid}`);

            // Prepare the request payload
            const postData = { sesid };

            try {
                // Make HTTP request to fetch admin stages
                const response = await $http({
                    url: "get-admin-stages",
                    method: "post",
                    data: postData
                });
                
                console.log(`[ActivityStateService::loadActivityPhases] Response received`);

                // Assign the stages to `phases`
                service.activityDescriptor.phases = response.data;

                // Map stage details to `phaseInformation`
                service.activityDescriptor.phaseInformation = response.data.map(stage => ({
                    name: `Stage ${stage.number}`,
                    val: stage.id
                }));

                console.log(`[ActivityStateService::loadActivityPhases] Updated phaseInformation: ${JSON.stringify(service.activityDescriptor.phaseInformation)}`);

                return service.activityDescriptor.phases;
            } catch (error) {
                console.error("[ActivityStateService::loadActivityPhases] Error fetching admin stages:", error);
                throw error;
            }
        }
    };

    return service; 
};

export { ActivityStateService };
