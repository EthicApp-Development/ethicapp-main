/**
 * What the collecting dispatches share (`report-building`, #944, and
 * `student-results-reading`, #1125): running one adapter handler under a
 * timeout, and classifying its error without keeping its text.
 */

export const TIMED_OUT = Symbol("timed out");

/**
 * Runs `handler(...handlerArgs)` and resolves to what it returns, or to
 * TIMED_OUT when it does not settle within `timeoutMs`. A handler that
 * outlives its timeout cannot be stopped; `controller` is aborted so it can
 * stop by itself (its `signal` is among `handlerArgs`), and what it returns
 * later is ignored. A synchronous throw rejects like an asynchronous one.
 *
 * @param {Function} handler
 * @param {unknown[]} handlerArgs
 * @param {number} timeoutMs
 * @param {AbortController} controller
 * @returns {Promise<unknown>}
 */
export async function runHandlerWithTimeout(handler, handlerArgs, timeoutMs, controller) {
    let timeoutId;
    const timeout = new Promise(resolve => {
        timeoutId = setTimeout(() => {
            controller.abort();
            resolve(TIMED_OUT);
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            Promise.resolve().then(() => handler(...handlerArgs)),
            timeout,
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
}

// An error's name and code, when they look like identifiers. Its message and
// stack are never kept: an adapter's error can quote a stored result, and
// with it a student's text.
const ERROR_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;

/**
 * @param {unknown} error
 * @returns {{ errorName: string|null, errorCode: string|null }}
 */
export function errorClassification(error) {
    const name = error?.name;
    const code = typeof error?.code === "number" ? String(error.code) : error?.code;
    return {
        errorName: typeof name === "string" && ERROR_IDENTIFIER_PATTERN.test(name) ? name : null,
        errorCode: typeof code === "string" && ERROR_IDENTIFIER_PATTERN.test(code) ? code : null,
    };
}
