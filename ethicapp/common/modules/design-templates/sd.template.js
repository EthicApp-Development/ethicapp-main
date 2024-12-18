// Semantic Differential Template
export const sdTemplate = { 
    "metainfo": {
        "title":         null,
        "author":        null,
        "creation_date": null // To be initialized dynamically
    },
    "roles":  [],
    "type":   "semantic_differential",
    "phases": [
        {
            "mode":               "individual",
            "chat":               false,
            "anonymous":          true,
            "grouping_algorithm": "random",
            "prevPhasesResponse": [],
            "stdntAmount":        3,
            "questions":          [
                {
                    "q_text":     "",
                    "ans_format": {
                        "values":          7,
                        "l_pole":          "",
                        "r_pole":          "",
                        "just_required":   true,
                        "min_just_length": 5
                    }
                }
            ]
        }
    ]
};