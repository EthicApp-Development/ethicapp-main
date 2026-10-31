// What a saved case reports about the designs that use it (#934, #939). When
// a case becomes private, through the case form (`PATCH /cases/:id`) or the
// share switch (`PATCH /cases/:id/visibility`), the server turns the public
// designs that use it private and lists their ids in `affectedDesignIds`.
// Both answers also count, in `designsKeepingAccess`, the designs of other
// teachers that use the case: their authors keep reading it, with its
// document and its pages, after it becomes private (epic #923).

const PUBLIC_VISIBILITY = "public";
const PRIVATE_VISIBILITY = "private";

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

/**
 * How many designs of other teachers keep the case, or null when the answer
 * does not say.
 * @param {Object|null|undefined} result - The `result` of the save.
 * @returns {number|null}
 */
export function caseDesignsKeepingAccess(result) {
    const value = result?.designsKeepingAccess;
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/**
 * Whether a save took a public case private.
 * @param {string|null|undefined} previousVisibility - Before the save.
 * @param {string|null|undefined} nextVisibility - After the save.
 * @returns {boolean}
 */
export function isCaseMadePrivate(previousVisibility, nextVisibility) {
    return previousVisibility === PUBLIC_VISIBILITY && nextVisibility === PRIVATE_VISIBILITY;
}

/**
 * The translation key and values of the message telling the author how many
 * designs of other teachers keep the case now private, or null when the answer
 * gives no count.
 * @param {Object|null|undefined} result - The `result` of the save.
 * @returns {{key: string, values: {count: number}}|null}
 */
export function designsKeepingAccessMessage(result) {
    const count = caseDesignsKeepingAccess(result);
    if (count === null) {
        return null;
    }

    let key = "ethical_cases_designs_keeping_access_other";
    if (count === 0) {
        key = "ethical_cases_designs_keeping_access_none";
    } else if (count === 1) {
        key = "ethical_cases_designs_keeping_access_one";
    }
    return { key, values: { count } };
}

/**
 * The messages for the teacher after a case save, in the order they are read:
 * the designs that became private (#934), then, when the save took a public
 * case private, the designs of other teachers that keep it (#939).
 * @param {Object|null|undefined} result - The `result` of the save.
 * @param {string|null|undefined} previousVisibility - Before the save.
 * @returns {{key: string, values: {count: number}}[]}
 */
export function caseVisibilityResultMessages(result, previousVisibility) {
    const messages = [designsMadePrivateMessage(result)];
    if (isCaseMadePrivate(previousVisibility, result?.visibility)) {
        messages.push(designsKeepingAccessMessage(result));
    }
    return messages.filter(Boolean);
}
