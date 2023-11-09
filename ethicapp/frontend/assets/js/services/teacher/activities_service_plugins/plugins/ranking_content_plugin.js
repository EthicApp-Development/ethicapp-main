export const CONTENT_PLUGIN_ID = "ranking";
export let addContentToPhase = ($http, sessionId, stageId, phaseDesign) => {
    if (phaseDesign == undefined || 
        !Object.prototype.hasOwnProperty.call(phaseDesign, "roles")) { 
        throw new Error("[RankingContentPlugin.addContentToPhase] One or more parameters missing.");
    }

    let promises = phaseDesign.roles.map((role) => {
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
                    if (response.status == "err") {
                        let err = "Call to add-actor failed";
                        console.error(err);
                        throw new Error(`[RankingContentPlugin.addContentToPhase] ${err}`);
                    }
                    else if (response.status != "ok") {
                        console.warn("[RankingContentPlugin.addContentToPhase] Call to add-actor " +
                            "with unknown result.");
                    }
                });
        };
    });
    
    // Sequential execution of promises, i.e., guarantee that actors are
    // created in the order that is specified per the design.
    promises.reduce((chain, currentPromise) => {
        return chain.then(currentPromise);
    }, Promise.resolve());
};




