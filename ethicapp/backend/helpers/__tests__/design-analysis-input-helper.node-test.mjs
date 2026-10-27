import assert from "node:assert/strict";
import test from "node:test";

import {
    buildDesignAnalysisInput,
    loadDesignCase,
    parseDesignDocument,
} from "../design-analysis-input-helper.js";

const CASE_ROW = {
    id:            "42",
    title:         "A case",
    language_code: "es",
    pdf_path:      "/uploads/cases/42/case.pdf",
    source_sha256: "abc123",
};

test("loadDesignCase: the case with the PDF hash its render job recorded", async () => {
    const hashed = [];
    const designCase = await loadDesignCase(42, {
        getCase: async caseId => ({ ...CASE_ROW, id: caseId }),
        hashPdf: async pdfPath => {
            hashed.push(pdfPath);
            return "sha256:file";
        },
    });

    assert.deepEqual(designCase, {
        id:           42,
        title:        "A case",
        languageCode: "es",
        contentHash:  "sha256:abc123",
    });
    assert.deepEqual(hashed, [], "the file is not read when the render job has its hash");
});

test("loadDesignCase: hashes the PDF when no render job matches it (copied cases)", async () => {
    const designCase = await loadDesignCase(43, {
        getCase: async () => ({ ...CASE_ROW, id: 43, source_sha256: null }),
        hashPdf: async pdfPath => `sha256:of:${pdfPath}`,
    });

    assert.equal(designCase.contentHash, "sha256:of:/uploads/cases/42/case.pdf");
});

test("loadDesignCase: no PDF, no hash; no case, null", async () => {
    const withoutPdf = await loadDesignCase(44, {
        getCase: async () => ({ ...CASE_ROW, pdf_path: null, source_sha256: null }),
        hashPdf: async () => assert.fail("no file to hash"),
    });
    assert.equal(withoutPdf.contentHash, null);

    assert.equal(await loadDesignCase(null, { getCase: async () => assert.fail("no case") }), null);
    assert.equal(await loadDesignCase(45, { getCase: async () => null }), null);
});

test("buildDesignAnalysisInput: passes the design and case, checks the result", async () => {
    const received = [];
    const result = await buildDesignAnalysisInput(args => {
        received.push(args);
        return { input: { a: 1 }, hash: "sha256:x" };
    }, { design: { valid: true }, designCase: { id: 1 } });

    assert.deepEqual(result, { input: { a: 1 }, hash: "sha256:x" });
    assert.deepEqual(received, [{ design: { valid: true }, designCase: { id: 1 } }]);
    assert.equal(await buildDesignAnalysisInput(() => null, {}), null);
    assert.equal(await buildDesignAnalysisInput(async () => undefined, {}), null);
    assert.deepEqual(
        await buildDesignAnalysisInput(() => ({ hash: "sha256:y" }), {}),
        { input: null, hash: "sha256:y" }
    );
    await assert.rejects(buildDesignAnalysisInput(() => ({ input: {} }), {}), TypeError);
    await assert.rejects(buildDesignAnalysisInput(() => ({ input: {}, hash: "" }), {}), TypeError);
});

test("parseDesignDocument: objects as they are, JSON strings parsed, garbage null", () => {
    assert.deepEqual(parseDesignDocument({ a: 1 }), { a: 1 });
    assert.deepEqual(parseDesignDocument("{\"a\":1}"), { a: 1 });
    assert.equal(parseDesignDocument("{"), null);
    assert.equal(parseDesignDocument(undefined), null);
});
