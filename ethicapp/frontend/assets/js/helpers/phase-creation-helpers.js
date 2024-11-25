export const itemBuilders = {
    semantic_differential: async (phase, stageid, sesid) => {
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
                    stageid:    stageid,
                    sesid:      sesid,
                    word_count: content.min_just_length,
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
                    word_count: role.wc,
                    stageid:    stageid,
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
