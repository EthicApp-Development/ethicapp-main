export let getBlankDesign = (title, author) => {
    return { 
        "metainfo": {
            "title":         title,
            "author":        author,
            "creation_date": Date.now()
        },
        "roles":  [],
        "type":   "ranking",
        "phases": [
            {
                "mode":               "individual",
                "chat":               false,
                "anonymous":          true,
                "grouping_algorithm": "random",
                "prevPhasesResponse": [ ],
                "stdntAmount":        3,
                "q_text":             "-->>N/A<<--",
                "roles":              [
                ]
            }
        ]
    };
};

export let copyPhase = (phase) => {
    return{
        mode:               phase.mode,
        chat:               phase.chat,
        anonymous:          phase.anonymous,
        grouping_algorithm: phase.grouping_algorithm,
        prevPhasesResponse: [],
        stdntAmount:        phase.stdntAmount,
        q_text:             phase.q_text,
        roles:              phase.roles
    };
}