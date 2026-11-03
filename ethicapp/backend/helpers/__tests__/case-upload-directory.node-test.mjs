// The removal of a deleted case's upload directory (#1010): `cases/<id>`
// under a temporary uploads root, kept while a row still references a path
// inside it, and never failing its caller.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import {
    CASE_UPLOAD_REMOVAL,
    removeCaseUploadDirectory,
} from "../case-upload-directory.js";

const uploadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-case-uploads-"));
const caseDirectory = path.join(uploadsRoot, "cases", "12");
const otherCaseDirectory = path.join(uploadsRoot, "cases", "120");

const silentLogger = { info() {}, error() {} };

async function exists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

function notReferenced() {
    return Promise.resolve(false);
}

after(() => fs.rm(uploadsRoot, { recursive: true, force: true }));

beforeEach(async () => {
    for (const directory of [caseDirectory, otherCaseDirectory]) {
        await fs.mkdir(path.join(directory, "rendered"), { recursive: true });
        await fs.writeFile(path.join(directory, "case.pdf"), "%PDF-1.4");
        await fs.writeFile(path.join(directory, "rendered", "page-1.png"), "png");
    }
});

describe("removeCaseUploadDirectory", () => {
    it("removes the case's directory, PDF and rendered pages, and nothing else", async () => {
        const requests = [];
        const outcome = await removeCaseUploadDirectory(12, {
            uploadsRoot,
            isStillReferenced: async (request) => {
                requests.push(request);
                return false;
            },
            logger: silentLogger,
        });

        assert.equal(outcome, CASE_UPLOAD_REMOVAL.REMOVED);
        assert.deepEqual(requests, [{ path: "cases/12", recursive: true }]);
        assert.equal(await exists(caseDirectory), false);
        assert.equal(await exists(path.join(otherCaseDirectory, "case.pdf")), true);
        assert.equal(await exists(path.join(uploadsRoot, "cases")), true);
    });

    it("counts a directory that does not exist as removed", async () => {
        const outcome = await removeCaseUploadDirectory(7, {
            uploadsRoot,
            isStillReferenced: notReferenced,
            logger:            silentLogger,
        });

        assert.equal(outcome, CASE_UPLOAD_REMOVAL.REMOVED);
    });

    it("keeps the directory while a row still references a path inside it", async () => {
        const outcome = await removeCaseUploadDirectory(12, {
            uploadsRoot,
            isStillReferenced: () => Promise.resolve(true),
            logger:            silentLogger,
        });

        assert.equal(outcome, CASE_UPLOAD_REMOVAL.KEPT);
        assert.equal(await exists(path.join(caseDirectory, "case.pdf")), true);
    });

    it("refuses an id that is not a positive integer, touching no file", async () => {
        const fileSystem = {
            rm() {
                throw new Error("must not be called");
            },
        };

        for (const caseId of [0, -1, 1.5, "12", "../12", Number.NaN]) {
            const outcome = await removeCaseUploadDirectory(caseId, {
                uploadsRoot,
                fileSystem,
                isStillReferenced: notReferenced,
                logger:            silentLogger,
            });
            assert.equal(outcome, CASE_UPLOAD_REMOVAL.INVALID);
        }
        assert.equal(await exists(caseDirectory), true);
    });

    it("logs a failure to remove and resolves instead of throwing", async () => {
        const logged = [];
        const outcome = await removeCaseUploadDirectory(12, {
            uploadsRoot,
            fileSystem: {
                rm() {
                    return Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }));
                },
            },
            isStillReferenced: notReferenced,
            logger:            { info() {}, error: (...args) => logged.push(args) },
        });

        assert.equal(outcome, CASE_UPLOAD_REMOVAL.FAILED);
        assert.equal(logged.length, 1);
        assert.equal(logged[0][1].caseId, 12);
    });

    it("logs a failed reference check and keeps the directory", async () => {
        const outcome = await removeCaseUploadDirectory(12, {
            uploadsRoot,
            isStillReferenced: () => Promise.reject(new Error("connection lost")),
            logger:            silentLogger,
        });

        assert.equal(outcome, CASE_UPLOAD_REMOVAL.FAILED);
        assert.equal(await exists(caseDirectory), true);
    });
});
