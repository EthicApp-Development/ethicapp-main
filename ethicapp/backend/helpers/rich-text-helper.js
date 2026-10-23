// Rich text for the backend (#764): plain-text renditions of teacher-written
// texts, for the CSV export and the AI service adapters (#768).
import MarkdownIt from "markdown-it";
import { createRichText } from "../../common/modules/rich-text.js";
import { TEXT_MARKDOWN } from "../../common/modules/text-content-types.js";

export const { parseRichText, toPlainText } = createRichText(MarkdownIt);

/**
 * `value` for places that cannot show formatting (#768): text/markdown becomes
 * its plain-text rendition. Anything else is returned exactly as it came, so
 * texts without a content type produce the same output as before.
 */
export function plainTextOf(value, contentType) {
    return contentType === TEXT_MARKDOWN && typeof value === "string"
        ? toPlainText(value, contentType)
        : value;
}
