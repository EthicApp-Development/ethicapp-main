# Rich Text for Teacher-Written Texts

This directory defines how EthicApp interprets texts that teachers write in designs (#762, part of epic #760):

- `rich-text-tree-v1.schema.json`: the normalized tree that every renderer produces.
- `fixtures.json`: conformance cases. Each one is an input, its content type, the expected tree, and the expected plain-text rendition.

The rules below are the contract. The fixtures are its executable form: when the two disagree, fix whichever is wrong, in the same change.

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
- backslash escapes and entity and character references (`&amp;`, `&#169;`), decoded into text.

**Every other construct is disabled.** A disabled construct is parsed as if CommonMark did not define it: its source stays in a paragraph as literal text, and the enabled inline constructs still apply inside it. For example, `# Título **fuerte**` is a paragraph with the text `# Título ` followed by strong `fuerte`.

The disabled constructs are:
- ATX and setext headings, and thematic breaks;
- block quotes;
- indented and fenced code, and code spans;
- raw HTML, blocks and inline;
- links, images, autolinks and link reference definitions.

Tables and other extensions are not CommonMark, so they are literal text too.

Raw HTML is never interpreted, which is one half of the injection rule below.

## The Tree

`rich-text-tree-v1.schema.json` defines the tree: an array of blocks.

- **Blocks:**
  - `paragraph`, whose children are inline nodes;
  - `list`, with `ordered`, `start` (the first number, or `null` for bulleted lists) and `items`. Each `listItem` holds blocks, so an item can contain paragraphs and nested lists.
- **Inline nodes:** `text` (`value`), `strong` and `emphasis` (`children`), and `break`.

**Normalization**, so that every renderer produces the same tree for the same input:
- A soft line break (a single newline inside a paragraph) becomes a space.
- Adjacent `text` nodes are merged, and no `text` node is empty.
- A paragraph with no children is dropped. An empty input, or one with only whitespace, is `[]`.
- The tree does not record whether a list was tight or loose: an item's text is always in a paragraph.

## Plain-Text Rendition

Used where formatting cannot be shown: the CSV export and the AI service adapters (#768).

- **`text/plain`:** the input, unchanged.
- **`text/markdown`:** built from the tree.
  - Blocks are separated by a blank line.
  - A `break` is a newline. `strong` and `emphasis` keep only their text.
  - Each list item is on its own line, prefixed `- ` or `N. `, where `N` counts from `start`.
  - An item's own continuation lines and nested lists are indented by the width of its marker (2 for `- `, 3 for `1. `).
  - No line ends with whitespace: an empty item renders as `-`.

## Rendering and Injection

Renderers build elements from the tree, never from the source text, and put `text` values into text nodes only. They must never assemble an HTML string from the input.

The elements allowed are:
- `p`, `ul`, `ol`, `li`, `strong`, `em` and `br`;
- the only attribute is `start` on `ol`, always an integer.

A list item with a single paragraph, nested lists aside, shows that paragraph's content directly in its `li`, as CommonMark renders tight lists. Items with several paragraphs keep their `p` elements.

Combined with raw HTML being disabled, a text cannot inject markup, scripts or URLs.

## Using the Fixtures

Each renderer's test suite reads `fixtures.json` and checks every case: `parse(input, contentType)` must deep-equal `tree`, and the plain-text function must equal `plainText`.

Read the file relative to the test module, for example `new URL("../../../../canonical-schemas/rich-text/fixtures.json", import.meta.url)` from `ethicapp/backend/<dir>/__tests__/`.

- **`ethicapp/frontend` and `ethicapp-student/frontend`** run their tests on the host only; their Docker builds run no tests.
- **`ethicapp/backend`** tests also run in the `backend-test` stage of `ethicapp/Dockerfile`, which copies only `ethicapp/backend` and `ethicapp/common`. The first backend or `ethicapp/common` test that reads the fixtures must add `COPY canonical-schemas/rich-text /canonical-schemas/rich-text` to that stage. The stage runs from `/app/backend`, so the relative path from the test file stays the same as in the repository.

**How the fixtures were made.** The trees were generated with `markdown-it` 15 in its `zero` preset, with only the subset's rules enabled (`list`, `emphasis`, `newline`, `escape`, `entity`) and `html: false`. Each one was then reviewed against the rules above. A renderer may use any CommonMark-compliant parser, as long as it passes every case.

## Extending the Subset

Later stages may enable more CommonMark constructs, such as links or headings. Enabling one changes how existing `text/markdown` that happens to contain its syntax renders. Therefore:

- **The editor must escape every Markdown character it writes as text** (#767), including those of disabled constructs. Text written by the editor then keeps its meaning when a construct is enabled.
- **An extension is versioned.** Bump `version` in `fixtures.json`, move the affected "disabled" cases to their new trees, and review stored `text/markdown` designs for text that would change.
- **Extensions stay within CommonMark.** Underline, colors and other non-standard syntax are out of scope by decision (#760).
