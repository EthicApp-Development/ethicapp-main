import crypto from "node:crypto";

/**
 * Hashes of analysis inputs (design analyses, epic #846). An adapter describes
 * what determines its result as a JSON value, and EthicApp compares the hash
 * of that value with the one stored with the analysis: an unchanged hash
 * needs no new generation.
 *
 * The JSON is stable: object keys are sorted, so two inputs with the same
 * content always produce the same hash, whatever the order their keys were
 * built in. Array order is kept, because it is meaningful (question order).
 */

function stableValue(value) {
    if (Array.isArray(value)) {
        return value.map(item => (item === undefined ? null : stableValue(item)));
    }

    if (value !== null && typeof value === "object") {
        if (typeof value.toJSON === "function") {
            return stableValue(value.toJSON());
        }

        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined) {
                sorted[key] = stableValue(value[key]);
            }
        }
        return sorted;
    }

    return value;
}

/**
 * JSON with object keys sorted at every level. `undefined` properties are
 * left out and `undefined` array items become null, as JSON.stringify does.
 *
 * @param {unknown} value - A JSON-compatible value.
 * @returns {string}
 */
export function stableStringify(value) {
    return JSON.stringify(stableValue(value)) ?? "null";
}

/**
 * The SHA-256 of a string, as `sha256:<hex>`.
 *
 * @param {string} text
 * @returns {string}
 */
export function sha256Text(text) {
    return `sha256:${crypto.createHash("sha256").update(String(text), "utf8").digest("hex")}`;
}

/**
 * The hash of an analysis input: the SHA-256 of its stable JSON, as
 * `sha256:<hex>`.
 *
 * @param {unknown} input - A JSON-compatible value.
 * @returns {string}
 */
export function hashAnalysisInput(input) {
    return sha256Text(stableStringify(input));
}
