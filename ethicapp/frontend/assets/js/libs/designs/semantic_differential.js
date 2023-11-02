export let getBlankDesign = (title, author) => {
    return { 
        "metainfo": {
            "title":         title,
            "author":        author,
            "creation_date": Date.now()
        },
        "roles":  [],
        "type":   "semantic_differential",
        "phases": [
            {
                "mode":               "individual",
                "chat":               false,
                "anonymous":          true,
                "grouping_algorithm": "random",
                "prevPhasesResponse": [ ],
                "stdntAmount":        3,
                "questions":          [
                    {
                        "q_text":     "-->>N/A<<--",
                        "ans_format": {
                            "values":          7,
                            "l_pole":          "-->>N/A<<--",
                            "r_pole":          "-->>N/A<<--",
                            "just_required":   true,
                            "min_just_length": 5
                        }
                    }
                ]
            }
        ]
    };
};

export let copyPhase = (phase) => {
    return {
        mode:               phase.mode,
        chat:               phase.chat,
        anonymous:          phase.anonymous,
        questions:          phase.questions,
        grouping_algorithm: phase.grouping_algorithm,
        prevPhasesResponse: [], // This is reset, as the user is expected to reconfigure it!
        stdntAmount:        phase.stdntAmount
    };
}

export let getBlankQuestion = () => {
    return {
        "q_text":     "",
        "ans_format": {
            "values":          5,
            "l_pole":          "",
            "r_pole":          "",
            "just_required":   true,
            "min_just_length": 10
        }
    }
};