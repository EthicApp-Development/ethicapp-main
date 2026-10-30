import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
    classifyFileSystemError,
    createUploadDeletionProcessor,
    resolveDeletablePath,
} from "../upload-deletion-processor.js";
import { caseIdOfPath, storedPathCandidates } from "../upload-deletion-requests.store.js";
import { RETRY_BASE_DELAY_MS } from "../../leased-queue/leased-request-processor.js";

const silentLogger = { info() {}, warn() {}, error() {} };

// A store over an in-memory list of requests, with the paths that rows still
// reference.
function makeStore(requests, { referenced = [] } = {}) {
    const calls = [];
    return {
        calls,
        async claimDue({ limit, userId }) {
            const due = requests.filter(request => request.status === "pending" && !request.claimed
                && (userId === null || request.userId === userId)).slice(0, limit);
            due.forEach(request => { request.claimed = true; });
            return due.map(request => ({ ...request }));
        },
        async isStillReferenced(request) {
            calls.push(["referenced?", request.path]);
            return referenced.includes(request.path);
        },
        async markDone(id) {
            calls.push(["done", id]);
        },
        async markCompleted(id, status, code) {
            calls.push([status, id, code]);
        },
        async markRetry(id, code, delayMs) {
            calls.push(["retry", id, code, delayMs]);
        },
        async markFailed(id, code) {
            calls.push(["failed", id, code]);
        },
    };
}

function request(id, requestPath, { recursive = false, attempts = 0 } = {}) {
    return { id, userId: 5, path: requestPath, recursive, status: "pending", attempts };
}

function outcomes(store) {
    return store.calls.filter(call => call[0] !== "referenced?");
}

describe("upload deletion processor (#877)", () => {
    let root;
    let outside;

    function write(relativePath, content = "x") {
        const absolutePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, content);
    }

    function exists(relativePath) {
        return fs.existsSync(path.join(root, relativePath));
    }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "ethicapp-uploads-"));
        outside = fs.mkdtempSync(path.join(os.tmpdir(), "ethicapp-outside-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    it("deletes a case directory and profile images, then the folder they leave empty", async () => {
        write("cases/12/case.pdf");
        write("cases/12/rendered/page-1.png");
        write("cases/12/representation.json");
        write("cases/13/case.pdf");
        write("user-profiles/5/user-5-original.jpg");
        write("user-profiles/5/user-5-topbar-64.jpg");
        const store = makeStore([
            request(1, "cases/12", { recursive: true }),
            request(2, "user-profiles/5/user-5-original.jpg"),
            request(3, "user-profiles/5/user-5-topbar-64.jpg"),
        ]);
        const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

        const summary = await processor.processDue();

        assert.deepEqual(summary, { done: 3, skipped: 0, retrying: 0, failed: 0 });
        assert.equal(exists("cases/12"), false);
        assert.equal(exists("cases/13/case.pdf"), true);
        assert.equal(exists("user-profiles/5"), false);
        assert.equal(exists("user-profiles"), true);
        assert.deepEqual(outcomes(store), [["done", 1], ["done", 2], ["done", 3]]);
    });

    it("keeps a path that a row still references", async () => {
        write("cases/12/case.pdf");
        const store = makeStore([request(1, "cases/12/case.pdf")], { referenced: ["cases/12/case.pdf"] });
        const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

        const summary = await processor.processDue();

        assert.equal(summary.skipped, 1);
        assert.equal(exists("cases/12/case.pdf"), true);
        assert.deepEqual(outcomes(store), [["skipped", 1, "STILL_REFERENCED"]]);
    });

    it("counts a path that no longer exists as deleted", async () => {
        const store = makeStore([request(1, "cases/99", { recursive: true }), request(2, "user-profiles/9/a.jpg")]);
        const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

        assert.deepEqual(await processor.processDue(), { done: 2, skipped: 0, retrying: 0, failed: 0 });
    });

    it("fails, without touching anything, a path ethicapp may not delete", async () => {
        write("cases/12/case.pdf");
        write("tmp/upload/file.pdf");
        const store = makeStore([
            request(1, "../outside/file"),
            request(2, "tmp/upload/file.pdf"),
            request(3, "cases"),
            request(4, "cases/12/case.pdf", { recursive: true }),
            request(5, "user-profiles/5", { recursive: true }),
            request(6, "cases/./12"),
        ]);
        const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

        const summary = await processor.processDue();

        assert.deepEqual(summary, { done: 0, skipped: 0, retrying: 0, failed: 6 });
        assert.equal(exists("cases/12/case.pdf"), true);
        assert.equal(exists("tmp/upload/file.pdf"), true);
        assert.deepEqual(store.calls.filter(call => call[0] === "referenced?"), []);
        assert.ok(outcomes(store).every(call => call[0] === "failed" && call[2] === "INVALID_PATH"));
    });

    it("does not follow a symbolic link out of the uploads root", async () => {
        fs.writeFileSync(path.join(outside, "secret.txt"), "keep me");
        fs.mkdirSync(path.join(root, "user-profiles"), { recursive: true });
        fs.symlinkSync(outside, path.join(root, "user-profiles", "5"));
        const store = makeStore([request(1, "user-profiles/5/secret.txt")]);
        const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

        const summary = await processor.processDue();

        assert.equal(summary.failed, 1);
        assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "keep me");
        assert.deepEqual(outcomes(store), [["failed", 1, "INVALID_PATH"]]);
    });

    it("retries a file system error with backoff, and fails one a retry cannot fix", async () => {
        write("cases/12/case.pdf");
        fs.mkdirSync(path.join(root, "user-profiles", "5", "a.jpg"), { recursive: true });
        const fileSystem = {
            ...fs.promises,
            async rm(target, options) {
                if (target.endsWith(path.join("cases", "12"))) {
                    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
                }
                return fs.promises.rm(target, options);
            },
        };
        const store = makeStore([
            request(1, "cases/12", { recursive: true, attempts: 2 }),
            request(2, "user-profiles/5/a.jpg"),
        ]);
        const processor = createUploadDeletionProcessor({
            store, uploadsRoot: root, fileSystem, logger: silentLogger,
        });

        const summary = await processor.processDue();

        assert.deepEqual(summary, { done: 0, skipped: 0, retrying: 1, failed: 1 });
        assert.deepEqual(outcomes(store), [
            ["retry", 1, "FS_EACCES", 4 * RETRY_BASE_DELAY_MS],
            ["failed", 2, "FS_EISDIR"],
        ]);
    });
});

describe("upload deletion paths", () => {
    it("resolves only paths under the deletable folders", () => {
        const root = path.resolve("/srv/uploads");
        assert.equal(resolveDeletablePath(root, { path: "cases/12", recursive: true }), "/srv/uploads/cases/12");
        assert.equal(
            resolveDeletablePath(root, { path: "user-profiles/5/a.jpg", recursive: false }),
            "/srv/uploads/user-profiles/5/a.jpg"
        );
        for (const candidate of [
            { path: "cases/12/rendered", recursive: true },
            { path: "cases/../12", recursive: false },
            { path: "/cases/12", recursive: false },
            { path: "cases//12", recursive: false },
            { path: "institution/logo.png", recursive: false },
            { path: 42, recursive: false },
        ]) {
            assert.equal(resolveDeletablePath(root, candidate), null, JSON.stringify(candidate));
        }
    });

    it("records file system errors as codes", () => {
        assert.deepEqual(classifyFileSystemError({ code: "EBUSY" }), { code: "FS_EBUSY", retryable: true });
        assert.deepEqual(classifyFileSystemError({ code: "ERR_FS_EISDIR" }), { code: "FS_EISDIR", retryable: false });
        assert.deepEqual(classifyFileSystemError(new Error("boom")), { code: "FS_ERROR", retryable: true });
    });

    it("matches every stored spelling of a path, and the case a path belongs to", () => {
        assert.deepEqual(storedPathCandidates("cases/12/case.pdf"), [
            "uploads/cases/12/case.pdf",
            "/uploads/cases/12/case.pdf",
            "assets/uploads/cases/12/case.pdf",
            "/assets/uploads/cases/12/case.pdf",
        ]);
        assert.equal(caseIdOfPath("cases/12"), 12);
        assert.equal(caseIdOfPath("cases/12/rendered/page-1.png"), 12);
        assert.equal(caseIdOfPath("cases/120x"), null);
        assert.equal(caseIdOfPath("user-profiles/12/a.jpg"), null);
    });
});
