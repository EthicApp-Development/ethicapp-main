export let getPhaseAPIObject = (params) => {
    if (params == undefined || 
        !Object.prototype.hasOwnProperty.call(params, "phaseNumber") || 
        !Object.prototype.hasOwnProperty.call(params, "sessionId") ||
        !Object.prototype.hasOwnProperty.call(params, "previousAnswerOptions")) { 
        throw new Error("[getPhaseAPIObject] One or more parameters missing.");
    }
    return {
        number:   params.phaseNumber,
        question: phase.q_text !== undefined ? phase.q_text : "",

        // Group phases require number of members plus grouping algorithm, separated
        // with a colon. Otherwise, just assign null.
        grouping: phase.mode == "team" ?
            phase.stdntAmount + ":" + phase.grouping_algorithm :
            null,
        type:     phase.mode,
        anon:     phase.anonymous,
        chat:     phase.chat,
        sesid:    params.sessionId,
        prev_ans: params.previousAnswerOptions
    };
};
