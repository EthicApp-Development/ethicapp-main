let addContentToPhase = (content) => {
    let _promises = phase.roles.map((role, index) => {
        return () => {
            let p = {
                name:       role.name,
                jorder:     role.type == "order",
                justified:  role.type != null,
                word_count: role.wc,
                stageid:    stageid,
            };
    
            return $http({url: "add-actor", method: "post", data: p})
                .then((response) => {
                    console.log("Actor added");
                    if (index === phase.roles.length - 1) {  // Si es la última iteración
                        let pp = {sesid: sessionId, stageid: stageid};
                        return $http({ url: "session-start-stage", method: "post", data: pp })
                            .then(() => {
                                Notification.success("Etapa creada correctamente");
                            });
                    }
                });
        };
    });
                                
    _promises.reduce((chain, currentPromise) => {
        return chain.then(currentPromise);
    }, Promise.resolve());

    let apiObject = getRankingItemAPIObject(content); // role, stageId
}




