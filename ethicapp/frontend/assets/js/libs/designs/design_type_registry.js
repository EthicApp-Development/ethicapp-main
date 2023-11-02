/* Original list of design types
self.typeNames = {
    L: "readComp", 
    S: "multSel", 
    M: "semUnits", 
    E: "ethics", 
    R: "rolePlaying", 
    T: "ethics",
    J: "jigsaw"
};*/

let registeredDesignTypes = () => {
    return [{
        name:      "semantic_differential",
        character: "T"
    },
    {
        name:      "ranking",
        character: "R"
    },
    {
        name:      "role_playing",
        character: "J"
    }];
};

export let lookupDesignTypeByName = (name) => {
    registeredDesignTypes().map(type => {
        if (type.name == name) {
            return type;
        }
    });
    return null;
};