export let getBlankSDDesign = (title, author) => {
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