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

export const rankingResponseTemplate = {
    items: []
};

export const rankingItemTemplate = {
    order: 0,
    description: '',
    actor_id: 0,
    phase_id: 0,
};
