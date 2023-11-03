let addContentToPhase = (stageId, phaseNumber, design) => {
    let _promises = phase.roles.map((role, index) => {
        return () => {
            let p = {
                name:       role.name,
                jorder:     role.type == "order",
                justified:  role.type != null,
                word_count: role.wc,
                stageid:    stageId,
            };
    
            return $http({url: "add-actor", method: "post", data: p})
                .then((response) => {
                    
                });
        };
    });
                                
    _promises.reduce((chain, currentPromise) => {
        return chain.then(currentPromise);
    }, Promise.resolve());

    let apiObject = getRankingItemAPIObject(content); // role, stageId
};




