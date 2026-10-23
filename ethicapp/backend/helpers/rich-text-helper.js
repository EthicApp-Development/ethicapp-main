// Rich text for the backend (#764): plain-text renditions of teacher-written
// texts, for the CSV export and the AI service adapters (#768).
import MarkdownIt from "markdown-it";
import { createRichText } from "../../common/modules/rich-text.js";

export const { parseRichText, toPlainText } = createRichText(MarkdownIt);
