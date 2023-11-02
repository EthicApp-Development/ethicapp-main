export let getRankingItemAPIObject = (role, stageId) => { 
    return {
        name:       role.name,
        jorder:     role.type == "order",
        justified:  role.type != null,
        word_count: role.wc,
        stageid:    stageId,
    };
};