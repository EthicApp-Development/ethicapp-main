import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    GOOGLE_DOCUMENT_KINDS,
    GOOGLE_DOCUMENT_PRODUCTS,
    canonicalGoogleDocumentUrl,
    googleDocumentKey,
    parseGoogleDocumentUrl,
    productFromMimeType,
} from "../../../common/modules/google-document-urls.js";

// Made-up ids in the shapes Google uses; no request ever reaches Google.
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xy";
const PUBLISHED_ID = "2PACX-1vQ_abcDEF-0123456789ghiJKLmnoPQRstuVWXyz";
const RESOURCE_KEY = "0-AbCdEf_GhIjKl";
const DOCS_PRODUCTS = ["document", "spreadsheets", "presentation"];

function driveFile(product, resourceKey = null) {
    return { kind: "drive_file", product, id: ID, resourceKey };
}

function published(product) {
    return { kind: "published", product, id: PUBLISHED_ID, resourceKey: null };
}

describe("Google document URLs (#791)", () => {
    it("exports frozen kinds and products", () => {
        assert.deepEqual(GOOGLE_DOCUMENT_KINDS, ["drive_file", "published"]);
        assert.deepEqual(GOOGLE_DOCUMENT_PRODUCTS,
            ["document", "spreadsheets", "presentation", "file"]);
        assert.ok(Object.isFrozen(GOOGLE_DOCUMENT_KINDS));
        assert.ok(Object.isFrozen(GOOGLE_DOCUMENT_PRODUCTS));
    });

    it("recognizes Docs, Sheets and Slides sharing links", () => {
        for (const product of DOCS_PRODUCTS) {
            const accepted = [
                `https://docs.google.com/${product}/d/${ID}`,
                `https://docs.google.com/${product}/d/${ID}/`,
                `https://docs.google.com/${product}/d/${ID}/edit`,
                `https://docs.google.com/${product}/d/${ID}/edit?usp=sharing`,
                `https://docs.google.com/${product}/d/${ID}/edit?usp=drive_link&tab=t.0`,
                `https://docs.google.com/${product}/d/${ID}/edit#gid=0`,
                `https://docs.google.com/${product}/d/${ID}/edit?gid=12&start=true#slide=id.p`,
                `https://docs.google.com/${product}/d/${ID}/view`,
                `https://docs.google.com/${product}/d/${ID}/preview`,
                `https://docs.google.com/${product}/d/${ID}/htmlview`,
                `https://docs.google.com/${product}/d/${ID}/mobilebasic`,
                `https://docs.google.com/${product}/u/0/d/${ID}/edit`,
                `https://docs.google.com/${product}/u/12/d/${ID}/view?usp=sharing`,
                `http://docs.google.com/${product}/d/${ID}/edit`,
                `  https://DOCS.Google.com/${product}/d/${ID}/edit  `,
            ];
            for (const url of accepted) {
                assert.deepEqual(parseGoogleDocumentUrl(url), driveFile(product), url);
            }
        }
    });

    it("recognizes Drive file links as product file", () => {
        const accepted = [
            `https://drive.google.com/file/d/${ID}`,
            `https://drive.google.com/file/d/${ID}/`,
            `https://drive.google.com/file/d/${ID}/view`,
            `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
            `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
            `https://drive.google.com/file/d/${ID}/edit`,
            `https://drive.google.com/file/d/${ID}/preview`,
            `https://drive.google.com/file/u/1/d/${ID}/view?usp=sharing`,
            `https://drive.google.com/open?id=${ID}`,
            `https://drive.google.com/open?usp=sharing&id=${ID}`,
            `http://Drive.Google.com/open?id=${ID}`,
        ];
        for (const url of accepted) {
            assert.deepEqual(parseGoogleDocumentUrl(url), driveFile("file"), url);
        }
    });

    it("recognizes documents published to the web", () => {
        for (const product of DOCS_PRODUCTS) {
            const base = `https://docs.google.com/${product}/d/e/${PUBLISHED_ID}`;
            const accepted = [
                `${base}/pub`,
                `${base}/pub?output=html`,
                `${base}/pubhtml`,
                `${base}/pubhtml?gid=0&single=true`,
                `${base}/embed`,
                `${base}/embed?start=false&loop=false`,
                `https://docs.google.com/${product}/u/0/d/e/${PUBLISHED_ID}/pub`,
            ];
            for (const url of accepted) {
                assert.deepEqual(parseGoogleDocumentUrl(url), published(product), url);
            }
        }
    });

    it("keeps a valid resource key on Drive file links", () => {
        const withKey = [
            [`https://drive.google.com/file/d/${ID}/view?usp=sharing&resourcekey=${RESOURCE_KEY}`,
                "file"],
            [`https://drive.google.com/open?id=${ID}&resourcekey=${RESOURCE_KEY}`, "file"],
            [`https://docs.google.com/document/d/${ID}/edit?resourcekey=${RESOURCE_KEY}`,
                "document"],
            [`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit?resourcekey=${RESOURCE_KEY}`
                + "#gid=0", "spreadsheets"],
        ];
        for (const [url, product] of withKey) {
            assert.deepEqual(parseGoogleDocumentUrl(url), driveFile(product, RESOURCE_KEY), url);
        }
    });

    it("rejects a Drive file link whose resource key is malformed", () => {
        const rejected = [
            `https://drive.google.com/file/d/${ID}/view?resourcekey=`,
            `https://drive.google.com/file/d/${ID}/view?resourcekey=bad%20key`,
            `https://drive.google.com/file/d/${ID}/view?resourcekey=a.b`,
            `https://drive.google.com/open?id=${ID}&resourcekey=${"k".repeat(129)}`,
            `https://docs.google.com/document/d/${ID}/edit?resourcekey=%22%3E%3Cscript%3E`,
        ];
        for (const url of rejected) {
            assert.equal(parseGoogleDocumentUrl(url), null, url);
        }
    });

    it("ignores resource keys on published links", () => {
        const base = `https://docs.google.com/document/d/e/${PUBLISHED_ID}/pub`;
        for (const key of [RESOURCE_KEY, "a.b", ""]) {
            const url = `${base}?resourcekey=${key}`;
            assert.deepEqual(parseGoogleDocumentUrl(url), published("document"), url);
        }
    });

    it("rejects other hosts, schemes, folders, malformed ids and non-strings", () => {
        const rejected = [
            // Other and look-alike hosts.
            `https://docs.google.com.evil.example/document/d/${ID}/edit`,
            `https://drive.google.com.evil.example/file/d/${ID}/view`,
            `https://evildocs.google.com/document/d/${ID}/edit`,
            `https://evil.example/document/d/${ID}/edit`,
            `https://evil.example/?u=https://docs.google.com/document/d/${ID}/edit`,
            `https://google.com/document/d/${ID}/edit`,
            `https://sheets.google.com/spreadsheets/d/${ID}/edit`,
            `https://drive.google.com/document/d/${ID}/edit`,
            `https://docs.google.com/file/d/${ID}/view`,
            // Other schemes and relative links.
            `javascript:alert("https://docs.google.com/document/d/${ID}/edit")`,
            `data:text/html,https://docs.google.com/document/d/${ID}/edit`,
            `ftp://docs.google.com/document/d/${ID}/edit`,
            `docs.google.com/document/d/${ID}/edit`,
            `//docs.google.com/document/d/${ID}/edit`,
            // Folders and other Drive pages.
            `https://drive.google.com/drive/folders/${ID}`,
            `https://drive.google.com/drive/u/0/folders/${ID}?usp=sharing`,
            "https://drive.google.com/drive/my-drive",
            `https://drive.google.com/uc?id=${ID}&export=download`,
            `https://drive.google.com/open?ids=${ID}`,
            `https://drive.google.com/open/extra?id=${ID}`,
            "https://docs.google.com/document/u/0/",
            "https://docs.google.com/forms/d/e/1FAIpQLSc_abcdefghijklmnopqrst/viewform",
            `https://docs.google.com/forms/d/${ID}/edit`,
            `https://docs.google.com/drawings/d/${ID}/edit`,
            `https://docs.google.com/document/u/x/d/${ID}/edit`,
            // The account index before the product, which Google answers with 404.
            `https://docs.google.com/u/0/document/d/${ID}/edit`,
            `https://docs.google.com/u/1/document/d/e/${PUBLISHED_ID}/pub`,
            `https://drive.google.com/u/1/file/d/${ID}/view`,
            `https://docs.google.com/Document/d/${ID}/edit`,
            // Missing, short, long or malformed file ids.
            "https://docs.google.com/document/d/",
            "https://docs.google.com/document/d//edit",
            "https://drive.google.com/file/d/",
            "https://drive.google.com/open",
            "https://drive.google.com/open?id=",
            `https://docs.google.com/document/d/${"a".repeat(19)}/edit`,
            `https://docs.google.com/document/d/${"a".repeat(129)}/edit`,
            `https://drive.google.com/file/d/${ID}.pdf/view`,
            `https://drive.google.com/file/d/${ID}%3E/view`,
            `https://drive.google.com/open?id=${ID}%22`,
            // Malformed published links.
            `https://docs.google.com/document/d/e/${PUBLISHED_ID.slice(6)}/pub`,
            `https://docs.google.com/document/d/e/2PACX-${"a".repeat(19)}/pub`,
            `https://docs.google.com/document/d/e/2PACX-${"a".repeat(201)}/pub`,
            `https://docs.google.com/document/d/e/${PUBLISHED_ID}`,
            `https://docs.google.com/document/d/e/${PUBLISHED_ID}/edit`,
            `https://docs.google.com/document/d/e/${PUBLISHED_ID}/preview`,
            "https://docs.google.com/document/d/e//pub",
            "https://docs.google.com/document/d/e/",
            `https://drive.google.com/file/d/e/${PUBLISHED_ID}/pub`,
            // Not URLs.
            "",
            "not a url",
            null,
            undefined,
            42,
            { href: `https://docs.google.com/document/d/${ID}/edit` },
        ];
        for (const value of rejected) {
            assert.equal(parseGoogleDocumentUrl(value), null, String(value));
        }
    });

    it("builds the opening URL chosen in #790 for every product and kind", () => {
        const expected = [
            [driveFile("document"), `https://docs.google.com/document/d/${ID}/preview`],
            [driveFile("spreadsheets"), `https://docs.google.com/spreadsheets/d/${ID}/preview`],
            [driveFile("presentation"), `https://docs.google.com/presentation/d/${ID}/preview`],
            [driveFile("file"), `https://drive.google.com/file/d/${ID}/preview`],
            [published("document"), `https://docs.google.com/document/d/e/${PUBLISHED_ID}/pub`],
            [published("spreadsheets"),
                `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`],
            [published("presentation"),
                `https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/pub`],
            [driveFile("file", RESOURCE_KEY),
                `https://drive.google.com/file/d/${ID}/preview?resourcekey=${RESOURCE_KEY}`],
            [driveFile("document", RESOURCE_KEY),
                `https://docs.google.com/document/d/${ID}/preview?resourcekey=${RESOURCE_KEY}`],
        ];
        for (const [parsed, url] of expected) {
            assert.equal(canonicalGoogleDocumentUrl(parsed), url, JSON.stringify(parsed));
        }
    });

    it("accepts an undefined resource key when building a URL", () => {
        const withoutKey = { kind: "drive_file", product: "document", id: ID };
        assert.equal(canonicalGoogleDocumentUrl(withoutKey),
            `https://docs.google.com/document/d/${ID}/preview`);
    });

    it("throws a TypeError on invalid parts", () => {
        const invalid = [
            null,
            undefined,
            "https://docs.google.com/document/d/x/edit",
            42,
            { ...driveFile("document"), kind: "folder" },
            { ...driveFile("document"), kind: undefined },
            { ...driveFile("document"), product: "forms" },
            { ...driveFile("document"), product: undefined },
            { ...driveFile("document"), id: "short" },
            { ...driveFile("document"), id: PUBLISHED_ID.replace("2PACX-", "2PACX.") },
            { ...driveFile("document"), id: `${ID}/../../evil` },
            { ...driveFile("document"), id: 42 },
            { ...driveFile("file"), resourceKey: "" },
            { ...driveFile("file"), resourceKey: "a&b=c" },
            { ...driveFile("file"), resourceKey: 42 },
            { ...published("document"), id: ID },
            { ...published("document"), id: `${PUBLISHED_ID}/../x` },
            published("file"),
            { ...published("document"), resourceKey: RESOURCE_KEY },
        ];
        for (const parsed of invalid) {
            assert.throws(() => canonicalGoogleDocumentUrl(parsed), TypeError,
                JSON.stringify(parsed) ?? String(parsed));
        }
    });

    it("parses every opening URL back into the same parts", () => {
        const parts = [
            ...GOOGLE_DOCUMENT_PRODUCTS.map((product) => driveFile(product)),
            ...GOOGLE_DOCUMENT_PRODUCTS.map((product) => driveFile(product, RESOURCE_KEY)),
            ...DOCS_PRODUCTS.map(published),
        ];
        for (const parsed of parts) {
            const url = canonicalGoogleDocumentUrl(parsed);
            assert.deepEqual(parseGoogleDocumentUrl(url), parsed, url);
        }
    });

    it("keys documents by kind and id", () => {
        assert.equal(googleDocumentKey(driveFile("document")), `drive_file:${ID}`);
        assert.equal(googleDocumentKey(driveFile("file", RESOURCE_KEY)), `drive_file:${ID}`);
        assert.equal(googleDocumentKey(published("spreadsheets")), `published:${PUBLISHED_ID}`);
        // The same file pasted as a Docs link and as a Drive link is one document.
        const docsLink = parseGoogleDocumentUrl(`https://docs.google.com/document/d/${ID}/edit`);
        const driveLink = parseGoogleDocumentUrl(`https://drive.google.com/open?id=${ID}`);
        assert.equal(googleDocumentKey(docsLink), googleDocumentKey(driveLink));
    });

    it("maps MIME types to products", () => {
        assert.equal(productFromMimeType("application/vnd.google-apps.document"), "document");
        assert.equal(productFromMimeType("application/vnd.google-apps.spreadsheet"),
            "spreadsheets");
        assert.equal(productFromMimeType("application/vnd.google-apps.presentation"),
            "presentation");
        const others = [
            "application/pdf",
            "image/png",
            "application/vnd.google-apps.folder",
            "application/vnd.google-apps.form",
            "APPLICATION/VND.GOOGLE-APPS.DOCUMENT",
            "toString",
            "__proto__",
            "",
            null,
            undefined,
            42,
            {},
        ];
        for (const mimeType of others) {
            assert.equal(productFromMimeType(mimeType), "file", String(mimeType));
        }
    });
});
