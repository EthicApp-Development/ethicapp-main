// Handles a single design currently being worked on.
let DesignStateService = ($rootScope, $http) => {
    const service = {
        designObj: {},
        designId: 0,
        instanceData: {},
        setDesign(designId, designObj) {
            service.designId = designId;
            service.designObj = designObj;
            service.notifySubscribers();
        },
        resetDesign() {
            service.designId = 0,
            service.designObj = null;
            service.notifySubscribers();
        },
        getDesignObj() {
            return service.designObj;
        },
        getDesignId() {
            return service.designId;
        },
        // Instantiation data is meant as contextual
        // information before an activity is launched
        // based on the design.
        setInstanceData: (id, title, type) => {
            service.instanceData.designId = id;
            service.instanceData.title = title;
            service.instanceData.type = type;
            service.instanceData.shortType = type == "semantic_differential" ? "T" : "R"
        },
        clearInstanceData: () => {
            service.instanceData.designId = 0;
            service.instanceData.title = '';
            service.instanceData.type = '';
            service.instanceData.shortType = '';
        },
        getInstanceData: () => {
            return service.instanceData;
        },
        notifySubscribers: function() {
            $rootScope.$broadcast('workingDesignChanged', 
                { designId: service.designId, designObj: service.designObj } );
        }  
    };

    return service;
};

export { DesignStateService };
