// Rich text for the teacher views (#764). The views render the tree (#765).
import MarkdownIt from "markdown-it";
import { createRichText } from "../../../../common/modules/rich-text.js";
import {
    canonicalYoutubeUrl, youtubeVideoId,
} from "../../../../common/modules/youtube-urls.js";

export const { parseRichText, toPlainText } = createRichText(MarkdownIt, {
    youtubeVideoId, canonicalYoutubeUrl,
});
