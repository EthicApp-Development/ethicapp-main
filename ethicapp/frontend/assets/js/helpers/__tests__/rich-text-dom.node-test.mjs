import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseRichText } from "../rich-text.js";
import {
    activateVideoFacade, buildRichTextFragment, buildVideoBlock, buildVideoPlayer,
    formatVideoDuration,
} from "../rich-text-dom.js";

const FIXTURES_URL = new URL("../../../../../../canonical-schemas/rich-text/fixtures.json",
    import.meta.url);
const { cases } = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));

const VIDEO_ID = "M7lc1UVf-VE";
const HTTP_URL = /^https?:\/\/[^/?#]/iu;
const LINK_ATTRIBUTES = "href,target,rel";

// Every element the views may build, with a check of its attributes.
const ALLOWED_ELEMENTS = {
    p:      attributes => attributes.length === 0,
    ul:     attributes => attributes.length === 0,
    li:     attributes => attributes.length === 0,
    strong: attributes => attributes.length === 0,
    em:     attributes => attributes.length === 0,
    br:     attributes => attributes.length === 0,
    ol:     (attributes, { start }) => attributes.length === 0
        || (attributes.join() === "start" && /^\d+$/u.test(start)),
    a: (attributes, { href, target, rel }) => attributes.join() === LINK_ATTRIBUTES
        && HTTP_URL.test(href) && target === "_blank" && rel === "noopener noreferrer",
    div:    attributes => attributes.join() === "class",
    span:   attributes => ["class", "class,aria-hidden"].includes(attributes.join()),
    button: (attributes, values) => attributes.join() === "class,type,data-video-id,aria-label"
        && values.type === "button" && /^[A-Za-z0-9_-]{11}$/u.test(values["data-video-id"]),
};

// Just enough of a DOM to see what the builder creates.
const fakeDocument = {
    createElement:          tag => ({ tag, attributes: {}, children: [], ...elementMethods }),
    createDocumentFragment: () => fakeDocument.createElement("#fragment"),
    createTextNode:         value => ({ text: value }),
};
const elementMethods = {
    setAttribute(name, value) {
        this.attributes[name] = value;
    },
    appendChild(child) {
        this.children.push(child);
        return child;
    },
};

function escape(text) {
    return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function serialize(node) {
    if ("text" in node) {
        return escape(node.text);
    }
    const inner = node.children.map(serialize).join("");
    if (node.tag === "#fragment") {
        return inner;
    }
    const attributes = Object.entries(node.attributes).map(([name, value]) => ` ${name}="${value}"`)
        .join("");
    return node.tag === "br" ? "<br>" : `<${node.tag}${attributes}>${inner}</${node.tag}>`;
}

function render(text, contentType, options) {
    return buildRichTextFragment(fakeDocument, parseRichText(text, contentType), options);
}

function eachElement(node, visit) {
    if ("text" in node) {
        return;
    }
    if (node.tag !== "#fragment") {
        visit(node);
    }
    node.children.forEach(child => eachElement(child, visit));
}

function caseVideo(youtubeVideoId, metadata) {
    const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    return { youtubeVideoId, position: 0, url, metadata };
}

function videoIds(tree) {
    return tree.filter(block => block.type === "video").map(block => block.videoId);
}

const SR_NEW_TAB = "<span class=\"sr-only\">(opens in a new tab)</span>";

describe("rich text DOM in the teacher views (#765)", () => {
    it("builds paragraphs, breaks, emphasis and lists", () => {
        const source = "**Lee** el *caso*\\\ny responde.\n\nDespués:";
        assert.equal(serialize(render(source, "text/markdown")),
            "<p><strong>Lee</strong> el <em>caso</em><br>y responde.</p><p>Después:</p>");
        assert.equal(serialize(render("3. tres\n   - a\n4. cuatro", "text/markdown")),
            "<ol start=\"3\"><li>tres<ul><li>a</li></ul></li><li>cuatro</li></ol>");
        assert.equal(serialize(render("1. uno", "text/markdown")), "<ol><li>uno</li></ol>",
            "start is only set when it is not 1");
    });

    it("keeps the paragraphs of list items with several blocks", () => {
        assert.equal(serialize(render("- uno\n\n  sigue\n- dos", "text/markdown")),
            "<ul><li><p>uno</p><p>sigue</p></li><li>dos</li></ul>");
    });

    it("renders text/plain with its line breaks and nothing interpreted", () => {
        assert.equal(serialize(render("**no**\n- tampoco\n\nfin", "text/plain")),
            "<p>**no**<br>- tampoco</p><p>fin</p>");
        assert.equal(serialize(render("**sin tipo**", undefined)), "<p>**sin tipo**</p>");
        assert.equal(serialize(render("[a](https://example.org)", "text/plain")),
            "<p>[a](https://example.org)</p>");
    });

    it("builds only the allowed elements and attributes for every fixture", () => {
        for (const fixture of cases) {
            const tree = parseRichText(fixture.input, fixture.contentType);
            const unavailable = videoIds(tree)
                .map(id => caseVideo(id, { availability: "removed" }));
            const known = videoIds(tree).map(id => caseVideo(id, {
                title: "Caso", durationSeconds: 75, availability: "available",
            }));
            for (const videos of [undefined, known, unavailable]) {
                eachElement(buildRichTextFragment(fakeDocument, tree, { videos }), element => {
                    const check = ALLOWED_ELEMENTS[element.tag];
                    assert.ok(check, `${fixture.name}: <${element.tag}>`);
                    assert.ok(check(Object.keys(element.attributes), element.attributes),
                        `${fixture.name}: attributes ${JSON.stringify(element.attributes)}`
                        + ` on <${element.tag}>`);
                });
            }
        }
        assert.equal(serialize(render("<img src=x onerror=\"alert(1)\">", "text/markdown")),
            "<p>&lt;img src=x onerror=\"alert(1)\"&gt;</p>");
    });

    it("renders nothing for empty text or a missing tree", () => {
        assert.equal(serialize(render("", "text/markdown")), "");
        assert.equal(serialize(buildRichTextFragment(fakeDocument, undefined)), "");
    });
});

describe("links in the teacher views (#785)", () => {
    it("opens http and https links in a new tab, with a hidden notice", () => {
        const source = "Lee [el **caso**](https://example.org/caso) y <http://example.org/b>";
        assert.equal(serialize(render(source, "text/markdown")),
            "<p>Lee <a href=\"https://example.org/caso\" target=\"_blank\""
            + ` rel="noopener noreferrer">el <strong>caso</strong> ${SR_NEW_TAB}</a> y`
            + " <a href=\"http://example.org/b\" target=\"_blank\" rel=\"noopener noreferrer\">"
            + `http://example.org/b ${SR_NEW_TAB}</a></p>`);
    });

    it("keeps YouTube links inside sentences and list items as links", () => {
        const html = serialize(render("- [uno](https://youtu.be/M7lc1UVf-VE)", "text/markdown"));
        assert.match(html, /^<ul><li><a href="https:\/\/youtu.be\/M7lc1UVf-VE" target="_blank"/u);
    });

    it("takes the translated new-tab notice", () => {
        const html = serialize(render("[a](https://example.org)", "text/markdown",
            { labels: { opensInNewTab: "(se abre en una pestaña nueva)" } }));
        assert.ok(html.includes("<span class=\"sr-only\">(se abre en una pestaña nueva)</span>"));
    });

    it("refuses any other href, keeping the link's text", () => {
        for (const href of ["javascript:alert(1)", "data:text/html,x", "mailto:a@example.org",
            "//example.org", "/caso", "https://", "", undefined]) {
            const emphasis = { type: "emphasis", children: [{ type: "text", value: "esto" }] };
            const link = { type: "link", href, children: [emphasis] };
            const tree = [{ type: "paragraph", children: [{ type: "text", value: "Ver " }, link] }];
            assert.equal(serialize(buildRichTextFragment(fakeDocument, tree)),
                "<p>Ver <em>esto</em></p>", String(href));
        }
    });

    it("leaves links the parser refuses as literal text", () => {
        assert.equal(serialize(render("[*correo*](mailto:a@example.org)", "text/markdown")),
            "<p>[<em>correo</em>](mailto:a@example.org)</p>");
    });
});

describe("the video facade in the teacher views (#785)", () => {
    const source = "[El <video>](https://www.youtube.com/watch?v=M7lc1UVf-VE&t=5)";

    function facadeOf(fragment) {
        const [box] = fragment.children;
        assert.equal(box.tag, "div");
        assert.equal(box.attributes.class, "rich-text-video");
        const [button] = box.children;
        assert.equal(button.tag, "button");
        return button;
    }

    function textOf(node) {
        return "text" in node ? node.text : node.children.map(textOf).join("");
    }

    it("builds a button from the id only, requesting nothing before activation", () => {
        const fragment = render(source, "text/markdown",
            { labels: { playVideo: "Reproducir video" } });
        assert.deepEqual(facadeOf(fragment).attributes, {
            "class":         "rich-text-video-facade",
            "type":          "button",
            "data-video-id": VIDEO_ID,
            "aria-label":    "Reproducir video: El <video>",
        });
        const html = serialize(fragment);
        assert.doesNotMatch(html, /https?:|youtube\.com|youtu\.be|ytimg|google|<img|<iframe/u);
        assert.equal(html,
            "<div class=\"rich-text-video\"><button class=\"rich-text-video-facade\""
            + ` type="button" data-video-id="${VIDEO_ID}"`
            + " aria-label=\"Reproducir video: El <video>\">"
            + "<span class=\"rich-text-video-placeholder\" aria-hidden=\"true\">"
            + "<span class=\"rich-text-video-play\"></span></span>"
            + "<span class=\"rich-text-video-caption\">"
            + "<span class=\"rich-text-video-title\">El &lt;video&gt;</span>"
            + "<span class=\"rich-text-video-details\">"
            + "<span class=\"rich-text-video-source\">YouTube</span></span></span>"
            + "</button></div>");
    });

    it("shows the duration from the case's videos", () => {
        const metadata = {
            title:           "Otro título",
            description:     "",
            channelTitle:    "Canal",
            durationSeconds: 933,
            availability:    "available",
        };
        const videos = [caseVideo(VIDEO_ID, metadata)];
        const facade = facadeOf(render(source, "text/markdown", { videos }));
        assert.equal(textOf(facade), "El <video>15:33YouTube",
            "the title comes from the text, the duration from the case");
    });

    it("shows no duration without case data, for unknown videos and for null metadata", () => {
        for (const videos of [undefined, [], [caseVideo("aaaaaaaaaaa", { durationSeconds: 60 })],
            [caseVideo(VIDEO_ID, null)], "not a list"]) {
            assert.equal(textOf(facadeOf(render(source, "text/markdown", { videos }))),
                "El <video>YouTube", JSON.stringify(videos));
        }
    });

    it("shows a notice and the watch link for unavailable videos", () => {
        for (const availability of ["removed", "private", "not_embeddable"]) {
            const videos = [caseVideo(VIDEO_ID, { availability })];
            const html = serialize(render(source, "text/markdown",
                { videos, labels: { videoUnavailable: "Video no disponible" } }));
            assert.equal(html, "<div class=\"rich-text-video-unavailable\">"
                + "<span class=\"rich-text-video-title\">El &lt;video&gt;</span>"
                + "<span class=\"rich-text-video-notice\">Video no disponible</span>"
                + `<a href="https://www.youtube.com/watch?v=${VIDEO_ID}" target="_blank"`
                + ` rel="noopener noreferrer">https://www.youtube.com/watch?v=${VIDEO_ID}`
                + ` ${SR_NEW_TAB}</a>`
                + "<span class=\"rich-text-video-source\">YouTube</span></div>", availability);
            assert.doesNotMatch(html, /<button/u);
        }
    });

    it("falls back to the title for a block without a valid YouTube id", () => {
        for (const block of [{ provider: "youtube", videoId: "\"><script>" },
            { provider: "vimeo", videoId: VIDEO_ID }]) {
            const tree = [{ type: "video", title: "Caso", ...block }];
            assert.equal(serialize(buildRichTextFragment(fakeDocument, tree)), "<p>Caso</p>");
        }
    });
});

describe("the video block outside rich text (#788)", () => {
    const metadata = {
        title:           "Título en YouTube",
        description:     "",
        channelTitle:    "Canal",
        durationSeconds: 933,
        availability:    "available",
    };

    it("builds the same facade as rich text videos", () => {
        const fromText = serialize(render(
            "[El <video>](https://www.youtube.com/watch?v=M7lc1UVf-VE)", "text/markdown",
            { videos: [caseVideo(VIDEO_ID, metadata)], labels: { playVideo: "Reproducir" } }));
        const block = buildVideoBlock(fakeDocument,
            { videoId: VIDEO_ID, title: "El <video>", metadata }, { playVideo: "Reproducir" });
        assert.equal(serialize(block), fromText);
        assert.match(fromText, /15:33/u);
        assert.doesNotMatch(fromText, /https?:|youtube\.com|ytimg|google|<img|<iframe/u);
    });

    it("builds the notice of an unavailable video, with English fallback labels", () => {
        const block = buildVideoBlock(fakeDocument,
            { videoId: VIDEO_ID, title: "Caso", metadata: { availability: "private" } });
        assert.equal(block.attributes.class, "rich-text-video-unavailable");
        assert.match(serialize(block), /Video not available.*\(opens in a new tab\)/u);
    });

    it("builds a facade with no duration when the metadata is missing", () => {
        const block = buildVideoBlock(fakeDocument,
            { videoId: VIDEO_ID, title: "Caso", metadata: null });
        assert.equal(block.attributes.class, "rich-text-video");
        assert.doesNotMatch(serialize(block), /rich-text-video-duration/u);
    });

    it("refuses anything but a video id", () => {
        for (const videoId of ["\"><script>", "https://youtu.be/x", undefined]) {
            assert.throws(() => buildVideoBlock(fakeDocument, { videoId, title: "x" }),
                TypeError, String(videoId));
        }
        assert.throws(() => buildVideoBlock(fakeDocument, null), TypeError);
    });
});

describe("activating a video facade (#785, #788)", () => {
    function fakeFacade(videoId) {
        const facade = {
            replacedWith:  null,
            getAttribute:  name => (name === "data-video-id" ? videoId : null),
            querySelector: () => ({ textContent: "El <video>" }),
            replaceWith(node) {
                this.replacedWith = node;
            },
        };
        return facade;
    }

    function fakeHost(facades) {
        const ownerDocument = {
            ...fakeDocument,
            createElement: tag => ({
                ...fakeDocument.createElement(tag),
                focused: false,
                focus() {
                    this.focused = true;
                },
            }),
        };
        return { ownerDocument, contains: node => facades.includes(node) };
    }

    function targetIn(facade) {
        return { closest: selector => (selector === ".rich-text-video-facade" ? facade : null) };
    }

    it("replaces the facade with the focused player", () => {
        const facade = fakeFacade(VIDEO_ID);
        const player = activateVideoFacade(fakeHost([facade]), targetIn(facade));
        assert.equal(facade.replacedWith, player);
        assert.equal(player.tag, "iframe");
        assert.equal(player.attributes.title, "El <video>");
        assert.match(player.attributes.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\//u);
        assert.equal(player.focused, true);
    });

    it("ignores clicks outside a facade of the host, or on a facade without a valid id", () => {
        const outside = fakeFacade(VIDEO_ID);
        const invalid = fakeFacade("\"><script>");
        const host = fakeHost([invalid]);
        for (const target of [targetIn(null), targetIn(outside), targetIn(invalid), {}, null]) {
            assert.equal(activateVideoFacade(host, target), null);
        }
        assert.equal(outside.replacedWith, null);
        assert.equal(invalid.replacedWith, null);
    });
});

describe("video durations (#785)", () => {
    it("formats m:ss and h:mm:ss", () => {
        assert.equal(formatVideoDuration(5), "0:05");
        assert.equal(formatVideoDuration(65), "1:05");
        assert.equal(formatVideoDuration(933), "15:33");
        assert.equal(formatVideoDuration(59.6), "1:00");
        assert.equal(formatVideoDuration(3600), "1:00:00");
        assert.equal(formatVideoDuration(3725), "1:02:05");
        assert.equal(formatVideoDuration(36000 + 59), "10:00:59");
    });

    it("has no duration for unknown or live videos", () => {
        for (const value of [null, undefined, 0, -3, Number.NaN, Infinity, "60"]) {
            assert.equal(formatVideoDuration(value), null, String(value));
        }
    });
});

describe("the video player (#785)", () => {
    it("embeds the privacy-enhanced player built from the id, autoplaying", () => {
        const player = buildVideoPlayer(fakeDocument, VIDEO_ID, "El <video>");
        const src = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`
            + "?playsinline=1&rel=0&autoplay=1";
        const allow = "accelerometer; autoplay; encrypted-media; gyroscope;"
            + " picture-in-picture; fullscreen";
        assert.equal(player.tag, "iframe");
        assert.deepEqual(player.attributes, {
            "class":           "rich-text-video-player",
            "src":             src,
            "title":           "El <video>",
            "allow":           allow,
            "allowfullscreen": "",
            "loading":         "lazy",
            "referrerpolicy":  "strict-origin-when-cross-origin",
        });
        assert.deepEqual(player.children, []);
    });

    it("refuses anything but a video id", () => {
        assert.throws(() => buildVideoPlayer(fakeDocument, "https://youtu.be/x", "x"), TypeError);
        assert.equal(buildVideoPlayer(fakeDocument, VIDEO_ID, "").attributes.title, "YouTube");
    });
});
