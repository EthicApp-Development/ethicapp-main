// Ranking Template
export const rankingTemplate = { 
    "metainfo": {
        "title":         null,
        "author":        null,
        "creation_date": null // To be initialized dynamically
    },
    "roles":  [],
    "type":   "ranking",
    "phases": [
        {
            "mode":               "individual",
            "chat":               false,
            "anonymous":          true,
            "grouping_algorithm": "random",
            "prevPhasesResponse": [],
            "stdntAmount":        3,
            "q_text":             "",
            "roles":              []
        }
    ]
};
