export let getPhaseAPIObject = (phase, number) => {
    return {
        number:   number,
        question: phase.q_text !== undefined ? phase.q_text : "",

        // Group phases require number of members plus grouping algorithm, separated
        // with a colon. Otherwise, just assign null.
        grouping: phase.mode == "team" ?
            phase.stdntAmount + ":" + phase.grouping_algorithm :
            null,
        type:     phase.mode,
        anon:     phase.anonymous,
        chat:     phase.chat,
        sesid:    sessionId,
        prev_ans: ""
    };
};