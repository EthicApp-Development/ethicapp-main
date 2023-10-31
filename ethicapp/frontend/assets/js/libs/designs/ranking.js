export let getBlankRankingDesign = (title, author) => {
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