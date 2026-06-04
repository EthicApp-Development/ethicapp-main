import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";

const uploadRoot = path.join(os.tmpdir(), `ethicapp-upload-test-${crypto.randomUUID()}`);

let pdfUpload;
let moveUploadedFile;
let removeUploadedFile;

function createApp(routeBuilder) {
    const app = express();
    routeBuilder(app);
    return app;
}

async function withServer(app, callback) {
    const server = app.listen(0, "127.0.0.1");

    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });

    const { port } = server.address();

    try {
        return await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

function buildForm(fieldName, fileContent, filename, type) {
    const form = new FormData();
    form.append(fieldName, new Blob([fileContent], { type }), filename);
    return form;
}

async function pathExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function listFiles(directory) {
    if (!(await pathExists(directory))) {
        return [];
    }

    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const nestedEntries = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return listFiles(entryPath);
        }
        return [entryPath];
    }));

    return nestedEntries.flat();
}

async function assertTemporaryUploadsClean() {
    const temporaryFiles = await listFiles(path.join(uploadRoot, "tmp"));
    assert.deepEqual(temporaryFiles, []);
}

before(async () => {
    process.env.UPLOADS_PATH = uploadRoot;
    const uploadModule = await import(`../upload.js?test=${crypto.randomUUID()}`);

    pdfUpload = uploadModule.pdfUpload;
    moveUploadedFile = uploadModule.moveUploadedFile;
    removeUploadedFile = uploadModule.removeUploadedFile;
});

afterEach(async () => {
    await fs.promises.rm(uploadRoot, { recursive: true, force: true });
});

after(() => {
    delete process.env.UPLOADS_PATH;
});

describe("upload middleware", () => {
    it("rejects non-PDF files on PDF routes", async () => {
        const app = createApp((testApp) => {
            testApp.post("/upload", pdfUpload, (req, res) => {
                res.status(200).json({ ok: true });
            });
        });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/upload`, {
                method: "POST",
                body: buildForm("pdf", "not a pdf", "sample.txt", "text/plain"),
            });

            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), {
                status:  "err",
                message: "Invalid file type.",
                code:    "INVALID_FILE_TYPE",
            });
        });

        await assertTemporaryUploadsClean();
    });

    it("rejects files over the upload size limit", async () => {
        const app = createApp((testApp) => {
            testApp.post("/upload", pdfUpload, (req, res) => {
                res.status(200).json({ ok: true });
            });
        });

        await withServer(app, async (baseUrl) => {
            const oversizedPdf = Buffer.alloc((5 * 1024 * 1024) + 1, "a");
            const response = await fetch(`${baseUrl}/upload`, {
                method: "POST",
                body: buildForm("pdf", oversizedPdf, "large.pdf", "application/pdf"),
            });

            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), {
                status:  "err",
                message: "File too large",
                code:    "FILE_TOO_LARGE",
            });
        });

        await assertTemporaryUploadsClean();
    });

    it("rejects uploads sent with the wrong file field", async () => {
        const app = createApp((testApp) => {
            testApp.post("/upload", pdfUpload, (req, res) => {
                res.status(200).json({ ok: true });
            });
        });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/upload`, {
                method: "POST",
                body: buildForm("file", "%PDF-1.4", "sample.pdf", "application/pdf"),
            });

            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), {
                status:  "err",
                message: "Unexpected field",
                code:    "UNEXPECTED_FILE_FIELD",
            });
        });

        await assertTemporaryUploadsClean();
    });

    it("does not create temporary files for unauthorized uploads", async () => {
        const app = createApp((testApp) => {
            testApp.post(
                "/upload",
                (req, res) => res.status(401).json({ status: "err", message: "Unauthorized" }),
                pdfUpload,
                (req, res) => res.status(200).json({ ok: true }),
            );
        });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/upload`, {
                method: "POST",
                body: buildForm("pdf", "%PDF-1.4", "sample.pdf", "application/pdf"),
            });

            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), {
                status: "err",
                message: "Unauthorized",
            });
        });

        await assertTemporaryUploadsClean();
    });

    it("moves valid uploads from tmp to the final domain path", async () => {
        const app = createApp((testApp) => {
            testApp.post("/upload", pdfUpload, async (req, res) => {
                const publicPath = "/uploads/cases/123/case.pdf";
                await moveUploadedFile(req.file, publicPath);
                res.status(200).json({ status: "ok", path: publicPath });
            });
        });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/upload`, {
                method: "POST",
                body: buildForm("pdf", "%PDF-1.4", "sample.pdf", "application/pdf"),
            });

            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), {
                status: "ok",
                path: "/uploads/cases/123/case.pdf",
            });
        });

        assert.equal(await pathExists(path.join(uploadRoot, "cases", "123", "case.pdf")), true);
        await assertTemporaryUploadsClean();
    });

    it("removes uploaded files and prunes empty temporary directories", async () => {
        const app = createApp((testApp) => {
            testApp.post("/upload", pdfUpload, async (req, res) => {
                await removeUploadedFile(req.file);
                res.status(400).json({ status: "err" });
            });
        });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/upload`, {
                method: "POST",
                body: buildForm("pdf", "%PDF-1.4", "sample.pdf", "application/pdf"),
            });

            assert.equal(response.status, 400);
        });

        assert.equal(await pathExists(path.join(uploadRoot, "tmp")), true);
        await assertTemporaryUploadsClean();
    });
});
