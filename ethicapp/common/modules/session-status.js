const statusCodes = {
    "initiated" : 1,
    "in_progress": 2,
    "finished" : 3
};

/**
 * Checks if a given session status is valid.
 * @param {integer} name - The name to validate.
 * @returns {boolean} - True if the name is valid, otherwise false.
 */
function isValidStatusType(name) {
    return Object.hasOwn(statusCodes, name);
}

/**
 * Retrieves the code of a specific session status, by its name.
 * @param {string} name - The name of the code value to retrieve.
 * @returns {integer|null} - The code associated with the given name.
 */
function getStatusCode(name) {
    return statusCodes[name] || null;
}

/**
 * Retrieves the name associated with a given session status code.
 * 
 * @param {Object} obj - The object to search.
 * @param {any} value - The value to find the corresponding key for.
 * @returns {string|null} - The name associated with the value, or null if not found.
 */
function getNameByCode(value) {
    return Object.keys(statusCodes).
        find(key => statusCodes[key] === value) || null;
}

// Export the functions and the design types object
export { statusCodes, isValidStatusType, getNameByCode, getStatusCode };

