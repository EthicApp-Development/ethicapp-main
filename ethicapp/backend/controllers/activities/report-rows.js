import { plainTextOf } from "../../helpers/rich-text-helper.js";

// The CSV shows question text as plain text: Markdown questions are rendered
// (#768). Other rows are left exactly as they were.
export function withPlainQuestionText(rows) {
    return rows.map(row => ({
        ...row,
        question_text: plainTextOf(row.question_text, row.question_text_content_type),
    }));
}
