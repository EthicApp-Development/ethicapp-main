// Content types of teacher-written texts: phase instructions and semantic
// differential questions (#762). The contract, including the CommonMark
// subset behind text/markdown, is canonical-schemas/rich-text/README.md.

export const TEXT_PLAIN = "text/plain";
export const TEXT_MARKDOWN = "text/markdown";
export const TEXT_CONTENT_TYPES = Object.freeze([TEXT_PLAIN, TEXT_MARKDOWN]);

/**
 * `value` if it is a known content type, else null. This is what gets stored:
 * null keeps meaning "not declared", which is read as text/plain.
 */
export function storedTextContentType(value) {
    return TEXT_CONTENT_TYPES.includes(value) ? value : null;
}

/** The content type a text is read with: missing or unknown values mean text/plain. */
export function resolveTextContentType(value) {
    return storedTextContentType(value) ?? TEXT_PLAIN;
}

/**
 * A phase's instructions and their content type. The design's instructions
 * win. Otherwise `fallbackText` is used, which is always text/plain: it is the
 * legacy phase question, which has no content type.
 * @returns {{ instructions: string, instructionsContentType: string }}
 */
export function phaseInstructions(phaseDesign, fallbackText) {
    if (typeof phaseDesign?.instructions === "string") {
        return {
            instructions:            phaseDesign.instructions,
            instructionsContentType: resolveTextContentType(phaseDesign.instructionsContentType),
        };
    }
    return {
        instructions:            typeof fallbackText === "string" ? fallbackText : "",
        instructionsContentType: TEXT_PLAIN,
    };
}
