// What a saved case reports about the designs that use it (#934). When a case
// becomes private, through the case form (`PATCH /cases/:id`) or the share
// switch (`PATCH /cases/:id/visibility`), the server turns the public designs
// that use it private and lists their ids in `affectedDesignIds`.

/**
 * The ids of the designs the save turned private, as positive integers.
 * @param {Object|null|undefined} result - The `result` of the save.
 * @returns {number[]}
 */
export function caseAffectedDesignIds(result) {
    const ids = Array.isArray(result?.affectedDesignIds) ? result.affectedDesignIds : [];
    return ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
}

/**
 * The translation key and values of the message telling the teacher that
 * designs became private, or null when none did.
 * @param {Object|null|undefined} result - The `result` of the save.
 * @returns {{key: string, values: {count: number}}|null}
 */
export function designsMadePrivateMessage(result) {
    const count = caseAffectedDesignIds(result).length;
    if (count === 0) {
        return null;
    }

    return {
        key: count === 1
            ? "ethical_cases_designs_made_private_one"
            : "ethical_cases_designs_made_private_other",
        values: { count },
    };
}
