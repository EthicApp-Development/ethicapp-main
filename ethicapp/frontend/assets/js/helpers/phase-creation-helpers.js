export const itemBuilders = {
    semantic_differential: (phase, stageId, sessionId) => {
        // Map the questions into payload objects and return the array
        return phase.questions.map((question, index) => {
            const content = question.ans_format;
            return {
                name:       question.q_text,
                tleft:      content.l_pole,
                tright:     content.r_pole,
                num:        content.values,
                orden:      index + 1,
                justify:    content.just_required,
                stageId:    stageId,
                sessionId:  sessionId,
                wordCount:  content.min_just_length,
            };
        });
    },
    ranking: (phase, stageId) => {
        // Map the roles into payload objects and return the array
        return phase.roles.map(role => {
            return {
                name:       role.name,
                jorder:     role.type === "order",
                justified:  role.type != null,
                wordCount:  role.wc,
                stageId:    stageId,
            };
        });
    },
};

export const phaseCreationRequestObject = (phase, number, sessionId) => {
    // Return the payload object for phase creation
    return {
        number:   number,
        question: phase.q_text !== undefined ? phase.q_text : "",
        grouping: phase.mode === "team" ? `${phase.stdntAmount}:${phase.grouping_algorithm}` : null,
        type:     phase.mode,
        anon:     phase.anonymous,
        chat:     phase.chat,
        sesid:    sessionId,
        prev_ans: phase.prevPhasesResponse,
    };
};

/*
export const itemBuilders = {
    semantic_differential: async (phase, stageId, sessionId) => {
        await Promise.all(
            phase.questions.map((question, index) => {
                const content = question.ans_format;
                const payload = {
                    name:       question.q_text,
                    tleft:      content.l_pole,
                    tright:     content.r_pole,
                    num:        content.values,
                    orden:      index + 1,
                    justify:    content.just_required,
                    stageId:    stageId,
                    sessionId:  sessionId,
                    wordCount:  content.min_just_length,
                };
                return $http(
                    { 
                        url: `/phases/${stageid}/items`, 
                        method: "post", 
                        data: payload 
                    });
            })
        );
    },
    ranking: async (phase, stageid, sesid) => {
        await Promise.all(
            phase.roles.map(role => {
                const payload = {
                    name:       role.name,
                    jorder:     role.type === "order",
                    justified:  role.type != null,
                    wordCount: role.wc,
                    stageId:    stageid,
                };
                return $http(
                    { 
                        url: `/phases/${stageid}/items`, 
                        method: "post", 
                        data: payload 
                    });
            })
        );
    },
};

export const phaseCreationRequestObject = (phase, number, sessionId) => {
    return {
        number:   number,
        question: phase.q_text !== undefined ? phase.q_text : "",
        grouping: phase.mode === "team" ? `${phase.stdntAmount}:${phase.grouping_algorithm}` : null,
        type:     phase.mode,
        anon:     phase.anonymous,
        chat:     phase.chat,
        sesid:    sessionId,
        prev_ans: phase.prevPhasesResponse,
    };
}
*/