let keyGroups = (k1, k2) => {
    return {
        key:  k1 + (k2 == null ? "" : " " + k2),
        name: k1 + (k2 == null ? "" : " " + k2)
        //name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2)) FIX TRANSLATION BUG
    };
};

export let getGroupingAlgorithmLabels = () => {
    return [
        keyGroups("random"), keyGroups("performance", "homog"),
        keyGroups("performance", "heterg"), 
        keyGroups("knowledgeType", "homog"), keyGroups("knowledgeType", "heterg"), 
        keyGroups("previous")
    ];
}

export let getInteractionTypes = () => {
    return [keyGroups("individual"), keyGroups("team")]        
}
