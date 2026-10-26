# Rich Text for Teacher-Written Texts

This directory defines how EthicApp interprets texts that teachers write in designs (#762, part of epic #760). Version 2 (#784, part of epic #779) adds links and YouTube video blocks.

- `rich-text-tree-v2.schema.json`: the normalized tree that every renderer produces.
- `fixtures.json`: conformance cases. Each one is an input, its content type, the expected tree, and the expected plain-text rendition.

The rules below are the contract. The fixtures are its executable form: when the two disagree, fix whichever is wrong, in the same change.

**Contract versions.** The fixtures' `version` is the contract version.
- **1** (#762): paragraphs, lists, emphasis and line breaks.
- **2** (#784): adds `http` and `https` links, and `video` blocks for YouTube.

Trees are derived from the stored text every time it is shown, and are never stored or exchanged. The tree schema therefore exists only in its current version; version 1 is in the git history.

## Content Types

A design declares the content type next to each text:

| Text | Content type field |
| --- | --- |
| `phases[].instructions` | `phases[].instructionsContentType` |
| `phases[].questions[].q_text` (semantic differential) | `phases[].questions[].q_text_content_type` |

The values are `text/plain` and `text/markdown` (`$defs/textContentType` in `../ethicapp-v1.schema.json`).

- **Missing or unknown values mean `text/plain`.** Every design written before #762 is `text/plain`.
- **`text/plain` is never interpreted as Markdown.** Text that already contains `*`, `- ` or `#` keeps showing them.

## `text/plain`

The tree is built from the text without interpreting it:

1. Line endings are normalized (`\r\n` and `\r` become `\n`), and the text is trimmed.
2. Runs of blank lines (empty, or only spaces and tabs) separate paragraphs. Several blank lines in a row separate only once.
3. Within a paragraph, each line becomes a `text` node, and consecutive lines are separated by a `break` node. Spaces inside a line are kept.

The plain-text rendition of `text/plain` is the input, unchanged.

## `text/markdown`: the CommonMark Subset

The text is parsed as [CommonMark](https://spec.commonmark.org/) with no extensions, so the stored text renders the same in any standard Markdown viewer.

**These constructs are enabled:**
- paragraphs;
- bulleted lists (`-`, `*`, `+`) and numbered lists (`1.` or `1)`), including nested lists;
- `**strong**` / `__strong__` and `*emphasis*` / `_emphasis_`;
- hard line breaks: a backslash at the end of a line, which is what the editor writes, or two trailing spaces;
- backslash escapes and entity and character references (`&amp;`, `&#169;`), decoded into text;
- since version 2, inline links (`[text](https://…)`) and autolinks (`<https://…>`) to `http` and `https` URLs. See [Links and Videos](#links-and-videos).

**Every other construct is disabled.** A disabled construct is parsed as if CommonMark did not define it: its source stays in a paragraph as literal text, and the enabled inline constructs still apply inside it. For example, `# Título **fuerte**` is a paragraph with the text `# Título ` followed by strong `fuerte`.

The disabled constructs are:
- ATX and setext headings, and thematic breaks;
- block quotes;
- indented and fenced code, and code spans;
- raw HTML, blocks and inline;
- images, link reference definitions, and reference links (`[text][label]`, `[label]`).

Without images, `![alt](https://…)` is a literal `!` followed by a link. Tables, bare URLs (`https://…` without angle brackets, `www.…`) and other extensions are not CommonMark, so they are literal text too.

Raw HTML is never interpreted, which is one half of the injection rule below.

## Links and Videos

**Destinations.** A link is made only when its destination, once normalized, is an `http` or `https` URL with a host: it starts with `http://` or `https://` (the scheme in any case) followed by a character other than `/`, `?` or `#`.
- **Any other destination is not a link,** whatever its scheme: `javascript:`, `data:`, `mailto:`, `ftp:`, relative and protocol-relative URLs (`/caso`, `//example.org`), `http:example.org`, `https://`, and an empty destination (`[text]()`).
- **Such a link stays literal,** as a disabled construct does: the whole source, brackets, parentheses and destination included, is paragraph text, and the enabled inline constructs still apply inside it. `[*correo*](mailto:a@example.org)` is the text `[`, emphasis `correo`, and the text `](mailto:a@example.org)`. The same holds for autolinks: `<mailto:a@example.org>`, `<a@example.org>` and `<ftp://example.org>` stay as written.
- **Inside another link's text,** a literal link does not prevent the outer link: `[ver [a]() aquí](https://example.org)` is one link whose text is `ver [a]() aquí`.

**`href`** is the destination as [markdown-it](https://github.com/markdown-it/markdown-it) 15 normalizes it (`normalizeLink`):
- backslash escapes and entity references are decoded (`&amp;` becomes `&`);
- an international host is converted to punycode (`ñandú.cl` becomes `xn--and-6ma2c.cl`);
- every character outside the URL-safe ASCII set (letters, digits and ``;/?:@&=+$,-_.!~*'()#``) is percent-encoded as UTF-8, and existing `%XX` sequences are kept. So an `href` never holds spaces, quotes or angle brackets.
- Nothing else changes: the scheme and host keep their case.

**Link text.**
- A link's text holds inline nodes, emphasis and breaks included, but never another link. An autolink inside a link's text keeps only its text.
- An autolink's text is its URL as written, with percent-encoding and punycode decoded for display: `<https://ñandú.cl/aves>` shows `https://ñandú.cl/aves`.
- A link with no visible text (`[](https://example.org)`, or only whitespace) takes its `href` as text.
- A link title (`[a](https://example.org "Título")`) is dropped.

**Videos.** A top-level paragraph whose only content, whitespace aside, is one link to a YouTube video becomes a `video` block.
- "A YouTube video" means that `youtubeVideoId(href)` of `ethicapp/common/modules/youtube-urls.js` returns an id. That covers every form it accepts: `youtube.com/watch?v=` on the `www.`, `m.` and `music.` hosts or none, `youtube.com/embed/`, `/shorts/`, `/live/` and `/v/`, `youtu.be/`, and `youtube-nocookie.com/embed/`, over `http` or `https`. Other query parameters, such as `t` or `si`, are ignored.
- The block keeps only the validated 11-character id, never the URL as written: `{ "type": "video", "provider": "youtube", "videoId": "M7lc1UVf-VE", "title": "Introducción al caso" }`.
- `title` is the link's text on one line: emphasis is dropped, breaks and runs of whitespace become single spaces, and the ends are trimmed. For an autolink, it is the URL.
- **The link stays a link** when the paragraph holds anything else (a sentence, a second link), when the link is inside emphasis, and inside list items. A video is a full-width block, so it is made only from paragraphs at the top level of the text.

Text written by the editor never turns into a link: it escapes `[`, `]`, `<` and `>` (#767), and bare URLs are not links. The only links the editor writes are the video paragraphs it inserts (#787), described in [How the Editor Writes Markdown](#how-the-editor-writes-markdown).

## The Tree

`rich-text-tree-v2.schema.json` defines the tree: an array of blocks.

- **Blocks:**
  - `paragraph`, whose children are inline nodes;
  - `list`, with `ordered`, `start` (the first number, or `null` for bulleted lists) and `items`. Each `listItem` holds paragraphs and lists, so an item can contain paragraphs and nested lists;
  - `video`, with `provider` (`"youtube"`), `videoId` and `title`, only at the top level.
- **Inline nodes:** `text` (`value`), `strong` and `emphasis` (`children`), `break`, and `link` (`href` and `children`).

**Normalization**, so that every renderer produces the same tree for the same input:
- A soft line break (a single newline inside a paragraph) becomes a space.
- Adjacent `text` nodes are merged, and no `text` node is empty.
- A paragraph with no children is dropped. An empty input, or one with only whitespace, is `[]`.
- The tree does not record whether a list was tight or loose: an item's text is always in a paragraph.
- Links and videos follow the rules of [Links and Videos](#links-and-videos).

## Plain-Text Rendition

Used where formatting cannot be shown: the CSV export and the AI service adapters (#768).

- **`text/plain`:** the input, unchanged.
- **`text/markdown`:** built from the tree.
  - Blocks are separated by a blank line.
  - A `break` is a newline. `strong` and `emphasis` keep only their text.
  - Each list item is on its own line, prefixed `- ` or `N. `, where `N` counts from `start`.
  - An item's own continuation lines and nested lists are indented by the width of its marker (2 for `- `, 3 for `1. `).
  - A `link` is `text (href)`, or just `href` when its text is the same: `el caso (https://example.org/caso)`.
  - A `video` is `Video: title (URL)`, where the URL is the canonical watch URL built from the id (`canonicalYoutubeUrl`, `https://www.youtube.com/watch?v=<id>`), or `Video: URL` when the title is that URL.
  - No line ends with whitespace: an empty item renders as `-`.

## Rendering and Injection

Renderers build elements from the tree, never from the source text, and put `text` values into text nodes only. They must never assemble an HTML string from the input.

The elements allowed are:
- `p`, `ul`, `ol`, `li`, `strong`, `em` and `br`. The only attribute is `start` on `ol`, always an integer.
- `a` for a `link`, with exactly these attributes: `href` from the tree, `target="_blank"` and `rel="noopener noreferrer"`. A view may end the link's content with a visually hidden notice that it opens in a new tab, in a `span` whose only attribute is `class`.
- The video facade for a `video` (teacher views in #785, student views in #786). Before activation, it shows the title, a generic EthicApp placeholder image and an indication that the video comes from YouTube, and it requests nothing from YouTube or Google. On activation it inserts an `iframe` whose `src` is `youtubeEmbedUrl(videoId)` (`https://www.youtube-nocookie.com/embed/<id>?playsinline=1&rel=0`), built by EthicApp from the id; a view may append `&autoplay=1`, since the tap already asked to play. Each view defines the facade's own elements; none of them carries a URL taken from the text.
  - **Teacher views (#785).** The facade is a `div` holding a `button` with `class`, `type="button"`, `data-video-id` (the validated id) and `aria-label` (the translated play label and the video's title), and `span` elements whose only attributes are `class` and, on the placeholder, `aria-hidden="true"`. The duration and availability come from the case's videos (`GET /cases/:id`) when the view has the case. A video the case reports as other than `available` shows a `div` with a notice and an `a` to `canonicalYoutubeUrl(videoId)` instead of a button. The player `iframe` has `class`, `src`, `title` (the video's title), `allow` (a fixed list), `allowfullscreen`, `loading="lazy"` and `referrerpolicy="strict-origin-when-cross-origin"`.
  - **Student views (#786).** The facade is a `div` holding a `button` with `class`, `type="button"`, `aria-label` (the translated play label and the video's title) and `aria-describedby` (its details), with `span` and `i` elements whose only attributes are `class`, `id` and `aria-hidden="true"`. The duration and availability come from the case's videos (`GET /cases/:id`). A video the case reports as other than `available` shows a `div` with `role="note"`, a notice and an `a` to `canonicalYoutubeUrl(videoId)` instead of a button. The player `iframe` has the same attributes as in the teacher views.

A list item with a single paragraph, nested lists aside, shows that paragraph's content directly in its `li`, as CommonMark renders tight lists. Items with several paragraphs keep their `p` elements.

Combined with raw HTML being disabled, a text cannot inject markup or scripts. The only URLs it can carry are `http` and `https` link destinations, percent-encoded by the parser, and YouTube video ids.

## Using the Fixtures

Each renderer's test suite reads `fixtures.json` and checks every case: `parse(input, contentType)` must deep-equal `tree`, and the plain-text function must equal `plainText`.

Read the file relative to the test module, for example `new URL("../../../../canonical-schemas/rich-text/fixtures.json", import.meta.url)` from `ethicapp/backend/<dir>/__tests__/`.

- **`ethicapp/frontend` and `ethicapp-student/frontend`** run their tests on the host only; their Docker builds run no tests.
- **`ethicapp/backend`** tests also run in the `backend-test` stage of `ethicapp/Dockerfile`, which copies only `ethicapp/backend` and `ethicapp/common`. The first backend or `ethicapp/common` test that reads the fixtures must add `COPY canonical-schemas/rich-text /canonical-schemas/rich-text` to that stage. The stage runs from `/app/backend`, so the relative path from the test file stays the same as in the repository.

**How the fixtures were made.** The trees were generated with `markdown-it` 15 in its `zero` preset, with only the subset's rules enabled (`list`, `emphasis`, `newline`, `escape`, `entity`, and since version 2 `link` and `autolink`) and `html: false`. For version 2, `validateLink` accepts only the destinations above, and an extra inline rule before `link` keeps `[text]()` literal, since markdown-it does not validate an empty destination. Each case was then reviewed against the rules above, and its links checked against those markdown-it finds with its default validation. A renderer may use any CommonMark-compliant parser, as long as it passes every case.

## How the Editor Writes Markdown

The design editor (#767, `ethicapp/frontend/assets/js/helpers/rich-text-markdown.js`) loads text through the same parser as the views, and writes it back as follows. Its tests check that every fixture survives a round trip (load, write, parse to the same tree), plus thousands of random documents.

- **Breaks and escapes.**
  - Line breaks are a backslash at the end of the line.
  - Every Markdown character written as text is escaped, and `-`, `+`, `=` and `1.` are escaped at the start of a line.
  - Whitespace at a mark's edges moves outside its delimiters.
- **Emphasis.**
  - Bold is `**…**` and italic `*…*`.
  - When two marks are open at once, they use different delimiter characters (`*` and `_`). A mark reopening right after another closes also switches character, so delimiter runs never merge.
  - Where a delimiter run would not count under CommonMark's flanking rules, for example `**¿qué?**` followed by a letter, the letter next to it is written as a character reference (`&#97;`). The reference reads back as the same letter.
- **Lists.**
  - Two consecutive lists of the same kind switch markers (`-` and `*`, `.` and `)`), so they do not merge.
  - Inside a list item, a nested list follows its paragraph on the next line when CommonMark allows it, which keeps the list tight.
- **Empty content.** Blank paragraphs, breaks at paragraph edges and documents with no visible text or video are dropped; the last ones are saved as `""`.
- **Videos (#787).** A `video` block loads as a video node, shown as a card, and the editor can insert one of the case's videos. It is written as its own paragraph holding only a link to the canonical watch URL: `[title](https://www.youtube.com/watch?v=<id>)`.
  - The title is written on one line, with runs of whitespace as single spaces and the ends trimmed, and escaped like any text, so brackets, backslashes and emphasis characters stay literal.
  - An empty title is written as the URL itself, `[https://www.youtube.com/watch?v=<id>](https://www.youtube.com/watch?v=<id>)`, which reads back with the URL as its title. A view therefore never shows an empty video title.
  - Videos are top-level blocks only, as in the tree: the editor inserts one at the cursor in a top-level paragraph, or after the list that holds the cursor.
- **Links.** The editor has no links. It loads a link as its text, marks kept, so saving such a text writes it back as plain, escaped text.
- **Its tests.** The fixture round trip compares against each tree with links flattened that way and videos kept. The random documents include link syntax, which must stay text, and top-level videos whose titles mix Markdown characters, brackets, backslashes, whitespace, URLs and empty strings.

## Extending the Subset

Later stages may enable more CommonMark constructs, as version 2 did with links. Enabling one changes how existing `text/markdown` that happens to contain its syntax renders. Therefore:

- **The editor must escape every Markdown character it writes as text** (#767), including those of disabled constructs. Text written by the editor then keeps its meaning when a construct is enabled.
- **An extension is versioned.** Bump `version` in `fixtures.json`, move the affected "disabled" cases to their new trees, and review stored `text/markdown` designs for text that would change.
- **Extensions stay within CommonMark.** Underline, colors and other non-standard syntax are out of scope by decision (#760).

**Version 2 and stored texts.** Text saved by the editor (#767) escapes `[`, `]`, `<` and `>`, so none of it becomes a link. Only `text/markdown` written another way, such as an imported design, can contain link syntax; it now renders as links, or as videos, where version 1 showed the source. The canonical seed designs hold no `text/markdown` texts.
