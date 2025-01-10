// designTypes.js
import { sdTemplate, sdResponseTemplate } from "./design-templates/sd.template.js";
import { rankingTemplate, rankingResponseTemplate } from "./design-templates/ranking.template.js";

/**
 * Object defining the supported design types.
 * Each type includes a description and a unique identifier.
 */
const designTypes = {
    ranking: {
        description: "Ranking design type, used for prioritizing items.",
        identifier: "R",
    },
    semantic_differential: {
        description: "Semantic differential design type, used for measuring attitudes.",
        identifier: "J",
    },
};

const designFactories = {
    createInstance: (template) => { 
        const instance = structuredClone(template);
        instance.metainfo.creation_date = Date.now();
        return instance;
    },
    ranking: (title, author) => { 
        const instance = designFactories.createInstance(rankingTemplate);
        instance.metainfo.author = author;
        instance.metainfo.title = title;
        return instance;
    },
    semantic_differential: (title, author) => {
        const instance = designFactories.createInstance(sdTemplate);
        instance.metainfo.author = author;
        instance.metainfo.title = title;
        return instance;
    }
};

const responseFactories = {
    createInstance: (template) => {
        const instance = structuredClone(template);
        instance.stime = Date.now();
        return instance;
    },
    ranking: (params) => {
        const { actorId, phaseId } = params;
        const instance = responseFactories.createInstance(rankingResponseTemplate);
        instance.actor_id = actorId;
        instance.phase_id = phaseId;
    },
    semantic_differential: (params) => {
        const { taskId, iteration = 1 } = params;
        const instance = responseFactories.createInstance(sdResponseTemplate);
        instance.did = taskId;
        instance.iteration = iteration;
    }
}

/**
 * Checks if a given design type is valid.
 * @param {string} type - The design type to validate.
 * @returns {boolean} - True if the design type is valid, otherwise false.
 */
function isValidDesignType(type) {
    return Object.hasOwn(designTypes, type);
}

/**
 * Retrieves the details of a specific design type.
 * @param {string} type - The design type to retrieve.
 * @returns {object|null} - The details of the design type if it exists, or null if it's invalid.
 */
function getDesignTypeDetails(type) {
    return designTypes[type] || null;
}

/**
 * Lists all supported design types.
 * @returns {object} - An array of all supported design types and their details.
 */
function listSupportedDesignTypes() {
    return Object.entries(designTypes).map(([type, details]) => ({
        type,
        ...details,
    }));
}

// Export the functions and the design types object
export { designTypes, designFactories, responseFactories, 
    isValidDesignType, getDesignTypeDetails, listSupportedDesignTypes };
