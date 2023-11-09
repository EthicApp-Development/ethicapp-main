export const CONTENT_PLUGIN_ID = "semantic_differential";
export let addContentToPhase = ($http, sessionId, stageId, phaseDesign) => {
    if (phaseDesign == undefined || 
        !Object.prototype.hasOwnProperty.call(phaseDesign, "questions")) {
        throw new Error("[RankingContentPlugin.addContentToPhase] One or more parameters missing.");
    }

    let promises = phaseDesign.questions.map((question, index) => {
        return () => {
            let content = question.ans_format;
            let p = {
                name:       question.q_text,
                tleft:      content.l_pole,
                tright:     content.r_pole,
                num:        content.values,
                orden:      index + 1,
                justify:    content.just_required,
                stageid:    stageId,   // TODO: the stage is bound to the session, thus sesid is not required!
                sesid:      sessionId, // TODO: modify API so that this parameter is not required
                word_count: content.min_just_length
            };

            return $http({url: "add-differential-stage", method: "post", data: p})
                .then((response) => {
                    if (response.status == "err") {
                        let err = "Call to add-differential-stage failed";
                        console.error(err);
                        throw new Error(
                            `[SemanticDifferentialContentPlugin.addContentToPhase] ${err}`);
                    }
                    else if (response.status != "ok") {
                        console.warn(
                            "[SemanticDifferentialContentPlugin.addContentToPhase] Call to " +
                            "add-actor with unknown result.");
                    }
                });            
        };
    });

    // Ensure sequential execution of promises to guarantee that order of items
    // is generated according to the design.
    promises.reduce((chain, currentPromise) => {
        return chain.then(currentPromise);
    }, Promise.resolve());
};



