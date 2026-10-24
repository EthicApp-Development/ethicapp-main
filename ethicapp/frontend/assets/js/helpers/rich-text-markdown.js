// Moves teacher-written text in and out of the editor (#767). Text is loaded
// through the views' own parser (#764), so the editor shows exactly what the
// views render; text/plain loads literally. The document is written back as
// the CommonMark subset of canonical-schemas/rich-text/README.md:
// - hard breaks are a backslash at the end of the line;
// - every Markdown character written as text is escaped, so the text keeps
//   its meaning if more CommonMark constructs are enabled later.

import { parseRichText } from "./rich-text.js";

// ─── Loading ────────────────────────────────────────────────────────────────

// The editor has no links or videos yet (#787): a link loads as its text, with
// its marks, and a video as a paragraph with its title. Saving such a text
// writes them back as plain text.
function inlineNodes(schema, nodes, marks = []) {
    return nodes.flatMap(node => {
        if (node.type === "text") {
            return [schema.text(node.value, marks)];
        }
        if (node.type === "break") {
            return [schema.nodes.hard_break.create(null, null, marks)];
        }
        if (node.type === "link") {
            return inlineNodes(schema, node.children, marks);
        }
        const mark = schema.marks[node.type === "strong" ? "strong" : "em"].create();
        return inlineNodes(schema, node.children, mark.addToSet(marks));
    });
}

function blockNodes(schema, blocks) {
    return blocks.map(block => {
        if (block.type === "paragraph") {
            return schema.nodes.paragraph.create(null, inlineNodes(schema, block.children));
        }
        if (block.type === "video") {
            return schema.nodes.paragraph.create(null, schema.text(block.title));
        }
        const items = block.items.map(item => {
            const children = blockNodes(schema, item.children);
            // A list item starts with a paragraph, even an empty one.
            if (children[0]?.type !== schema.nodes.paragraph) {
                children.unshift(schema.nodes.paragraph.create());
            }
            return schema.nodes.list_item.create(null, children);
        });
        return block.ordered
            ? schema.nodes.ordered_list.create({ order: block.start }, items)
            : schema.nodes.bullet_list.create(null, items);
    });
}

/** The editor document for `text`, read as `contentType` says. */
export function docFromText(schema, text, contentType) {
    const blocks = blockNodes(schema, parseRichText(text, contentType));
    const content = blocks.length > 0 ? blocks : [schema.nodes.paragraph.create()];
    return schema.nodes.doc.create(null, content);
}

// ─── Saving ─────────────────────────────────────────────────────────────────

// Escaped anywhere they appear as text.
const ALWAYS_ESCAPED = /[\\`*_[\]<>&!#~|]/gu;
// Escaped where they would start a list, a heading underline or a break.
const LINE_START_MARKER = /^([-+=])/u;
const LINE_START_ORDERED = /^(\d+)([.)])/u;

// CommonMark's delimiter rules see these two kinds of characters specially.
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

// A letter or digit next to a delimiter, written as a character reference so
// the delimiter sees punctuation there and still counts: "**¿qué?**&#97;".
function characterReference(character) {
    return `&#${character.codePointAt(0)};`;
}

const DELIMITERS = {
    "*": { em: "*", strong: "**" },
    "_": { em: "_", strong: "__" },
};

function escapeText(text, atLineStart) {
    let escaped = text.replace(ALWAYS_ESCAPED, "\\$&");
    if (atLineStart) {
        escaped = escaped
            .replace(LINE_START_MARKER, "\\$1")
            .replace(LINE_START_ORDERED, "$1\\$2");
    }
    return escaped;
}

function markNames(node) {
    return ["em", "strong"].filter(name => node.marks.some(mark => mark.type.name === name));
}

// Drops breaks and blank text at the edges of a paragraph: Markdown cannot
// express them, and a backslash ending a paragraph would be literal.
function trimmedInline(paragraph) {
    const nodes = [];
    paragraph.forEach(node => nodes.push(node));
    const isEdge = node => node && (node.type.name === "hard_break" || !node.text?.trim());
    while (isEdge(nodes[0])) {
        nodes.shift();
    }
    while (isEdge(nodes[nodes.length - 1])) {
        nodes.pop();
    }
    return nodes;
}

// How many characters each mark keeps going from `index` on, so that marks
// opening together nest with the longest outside and rarely need reopening.
function markExtent(nodes, index, name) {
    let length = 0;
    for (let next = index; next < nodes.length; next += 1) {
        if (!markNames(nodes[next]).includes(name)) {
            break;
        }
        length += nodes[next].isText ? nodes[next].text.length : 1;
    }
    return length;
}

// CommonMark's "flanking" rules decide whether a delimiter run can open or
// close emphasis, from the characters around it. A boundary between two
// texts may hold runs that close marks and runs that open others; `runs` are
// their characters in order, and `before`/`after` the text characters around
// them (null at a paragraph's edge, which counts as whitespace).
const DELIMITER_CHARACTERS = ["*", "_"];

function kindOf(character) {
    if (character === null || WHITESPACE.test(character)) {
        return "space";
    }
    return PUNCTUATION.test(character) ? "punctuation" : "word";
}

function runWorks({ character, closes }, previous, next) {
    const left = next !== "space" && (next !== "punctuation" || previous !== "word");
    const right = previous !== "space" && (previous !== "punctuation" || next !== "word");
    if (closes) {
        return right && (character === "*" || !left || next === "punctuation");
    }
    return left && (character === "*" || !right || previous === "punctuation");
}

// Delimiter characters for marks opening together, outermost first: none
// shared with a mark that stays open, nor with the run just closed next to it.
function openingCharacters(count, remaining, lastClosed) {
    const used = remaining.map(entry => entry.character);
    const characters = [];
    for (let index = 0; index < count; index += 1) {
        const neighbour = index === 0 ? lastClosed : characters[index - 1];
        const avoid = [...used, ...(neighbour ? [neighbour] : [])];
        characters.push(DELIMITER_CHARACTERS.find(character => !avoid.includes(character))
            ?? DELIMITER_CHARACTERS.find(character => !used.includes(character))
            ?? "*");
    }
    return characters;
}

// Which neighbours to write as character references so that every group of
// runs reads back: leave them as they are if possible, else encode the letter
// after, the letter before, or both.
const ENCODING_OPTIONS = [[false, false], [false, true], [true, false], [true, true]];

// `canEncodeBefore` says whether the letter before may change: an earlier run
// right before it was written expecting a letter there.
function referencesNeeded(groups, beforeCharacter, afterCharacter, canEncodeBefore) {
    const needed = { before: false, after: false };
    for (const group of groups.filter(candidate => candidate.runs.length > 0)) {
        const before = group.at === "after" ? "space" : kindOf(beforeCharacter);
        const after = group.at === "before" ? "space" : kindOf(afterCharacter);
        const choice = ENCODING_OPTIONS
            .filter(([encodeBefore, encodeAfter]) =>
                (!encodeBefore || (before === "word" && canEncodeBefore))
                && (!encodeAfter || after === "word"))
            .find(([encodeBefore, encodeAfter]) => runsWork(group.runs,
                encodeBefore ? "punctuation" : before, encodeAfter ? "punctuation" : after));
        if (choice) {
            needed.before ||= choice[0];
            needed.after ||= choice[1];
        }
    }
    return needed;
}

function runsWork(runs, before, after) {
    return runs.every((run, index) => runWorks(
        run,
        index === 0 ? before : "punctuation",
        index === runs.length - 1 ? after : "punctuation"
    ));
}

// Writes one paragraph's inline content. Emphasis delimiters hug the text:
// whitespace at a mark's edges moves outside it. So that every delimiter run
// reads back as written:
// - each open mark uses its own delimiter character ("*" or "_"), and a mark
//   opening right after another closes uses the other one, so runs never
//   merge and a closing run can only match its own opening;
// - where a run still would not count, the letter next to it is written as a
//   character reference ("&#97;"), which the run sees as punctuation.
function serializeParagraph(paragraph) {
    const nodes = trimmedInline(paragraph);
    const active = [];
    let output = "";
    let atLineStart = true;
    // The runs written last, if text follows them directly: where they end in
    // `output`, and what they saw before them.
    let lastRuns = null;

    const sharedDepth = names => {
        let shared = 0;
        while (shared < active.length && names.includes(active[shared].name)) {
            shared += 1;
        }
        return shared;
    };

    // Closes the marks above `depth`; whitespace that ended the text stays after them.
    const closeTo = depth => {
        const trailing = output.match(/[ \t]*$/u)[0];
        output = output.slice(0, output.length - trailing.length);
        while (active.length > depth) {
            const { name, character } = active.pop();
            output += DELIMITERS[character][name];
        }
        output += trailing;
    };

    nodes.forEach((node, index) => {
        if (node.type.name === "hard_break") {
            // A run right before "\" (punctuation) always closes.
            closeTo(sharedDepth(markNames(node)));
            output += "\\\n";
            atLineStart = true;
            return;
        }

        let text = atLineStart ? node.text.replace(/^[ \t]+/u, "") : node.text;
        if (!text.trim()) {
            // Whitespace alone never opens or closes emphasis.
            output += text;
            return;
        }

        const names = markNames(node);
        const shared = sharedDepth(names);
        const remaining = active.slice(0, shared);
        const extent = name => markExtent(nodes, index, name);
        const opening = names
            .filter(name => !remaining.some(entry => entry.name === name))
            .sort((left, right) => extent(right) - extent(left));
        const closing = active.slice(shared).reverse();
        const leading = text.match(/^[ \t]*/u)[0];
        text = text.slice(leading.length);
        let escaped = escapeText(text, atLineStart && !leading);

        const trailing = output.match(/[ \t]*$/u)[0];
        const body = output.slice(0, output.length - trailing.length);
        const separated = Boolean(trailing || leading);
        const lastClosed = closing.length > 0 && !separated
            ? closing[closing.length - 1].character
            : null;
        const characters = openingCharacters(opening.length, remaining, lastClosed);

        // Whitespace splits the closing and opening runs into separate groups.
        const closingRuns = closing.map(entry => ({ character: entry.character, closes: true }));
        const openingRuns = characters.map(character => ({ character, closes: false }));
        const groups = separated
            ? [{ runs: closingRuns, at: "before" }, { runs: openingRuns, at: "after" }]
            : [{ runs: [...closingRuns, ...openingRuns], at: "both" }];
        const beforeCharacter = [...body].pop() ?? null;
        const [afterCharacter] = escaped;
        // Changing the letter before is fine unless runs written right before
        // it stop working; then the letter before those runs may change too.
        const beforeStart = body.length - (beforeCharacter?.length ?? 0);
        const followsRuns = lastRuns && lastRuns.end === beforeStart;
        const keepsLastRuns = !followsRuns
            || runsWork(lastRuns.runs, lastRuns.before, "punctuation");
        const cascades = !keepsLastRuns && lastRuns.before === "word" && lastRuns.canEncodeBefore
            && runsWork(lastRuns.runs, "punctuation", "punctuation");
        const references = referencesNeeded(groups, beforeCharacter, afterCharacter,
            keepsLastRuns || cascades);
        if (references.before) {
            let kept = body.slice(0, beforeStart);
            if (cascades) {
                const { beforeStart: earlierStart, beforeCharacter: earlier } = lastRuns;
                kept = kept.slice(0, earlierStart) + characterReference(earlier)
                    + kept.slice(earlierStart + earlier.length);
            }
            output = kept + characterReference(beforeCharacter) + trailing;
        }
        const touchingKind = references.before ? "punctuation" : kindOf(beforeCharacter);
        if (references.after) {
            escaped = characterReference(afterCharacter) + escaped.slice(afterCharacter.length);
        }

        closeTo(shared);
        output += leading;
        opening.forEach((name, position) => {
            output += DELIMITERS[characters[position]][name];
            active.push({ name, character: characters[position] });
        });
        // The group touching this text, for the next boundary to check.
        const touching = groups[groups.length - 1];
        const touchingBefore = touching.at === "after" ? "space" : touchingKind;
        const touchingStart = touching.at === "after" ? null : beforeStart;
        lastRuns = touching.runs.length > 0
            ? {
                end:             output.length,
                runs:            touching.runs,
                before:          touchingBefore,
                // The letter before these runs, for a later cascade.
                beforeStart:     touchingStart,
                beforeCharacter: references.before ? null : beforeCharacter,
                canEncodeBefore: touchingStart !== null && !references.before && !followsRuns,
            }
            : null;
        output += escaped;
        atLineStart = false;
    });
    closeTo(0);
    return output.trim();
}

function indentContinuation(text, width) {
    const indent = " ".repeat(width);
    return text.split("\n")
        .map((line, index) => (index === 0 || line === "" ? line : indent + line))
        .join("\n");
}

function serializeList(list, alternate) {
    const ordered = list.type.name === "ordered_list";
    const start = ordered ? list.attrs.order : null;
    const items = [];
    list.forEach((item, _offset, index) => {
        const marker = ordered
            ? `${start + index}${alternate ? ")" : "."} `
            : `${alternate ? "*" : "-"} `;
        const body = serializeBlocks(item, { inListItem: true });
        items.push(body ? marker + indentContinuation(body, marker.length) : marker.trimEnd());
    });
    return items.join("\n");
}

// A list can follow a paragraph on the next line when CommonMark lets it
// interrupt one: bulleted lists, and numbered lists that start at 1, whose
// first item is not empty.
function canInterruptParagraph(list, text) {
    const firstItemHasText = /^\S+ \S/u.test(text.split("\n")[0]);
    return firstItemHasText && (list.type.name === "bullet_list" || list.attrs.order === 1);
}

// Blocks are separated by a blank line. Inside a list item, a list right after
// a paragraph goes on the next line, which keeps the list tight.
function serializeBlocks(container, { inListItem = false } = {}) {
    let output = "";
    let previous = null;
    let alternate = false;
    container.forEach(node => {
        const isParagraph = node.type.name === "paragraph";
        let text;
        if (isParagraph) {
            text = serializeParagraph(node);
            if (!text) {
                return;
            }
        } else {
            // Two lists of the same kind in a row would merge: switch markers.
            alternate = previous?.type.name === node.type.name ? !alternate : false;
            text = serializeList(node, alternate);
        }

        if (previous) {
            const tight = inListItem && !isParagraph && previous.type.name === "paragraph"
                && canInterruptParagraph(node, text);
            output += tight ? "\n" : "\n\n";
        }
        output += text;
        previous = node;
    });
    return output;
}

/** The document as text/markdown; "" when it holds no visible text. */
export function markdownFromDoc(doc) {
    if (!doc.textContent.trim()) {
        return "";
    }
    return serializeBlocks(doc);
}
