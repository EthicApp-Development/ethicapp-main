// Integration tests for the deletion of upload files (V32, #877), against a
// real PostgreSQL database with migrations V1-V32 applied and a temporary
// uploads root: the processor deletes what forgetting an account freed,
// keeps what a row still references (a copy whose PDF copy failed points to
// the source case's PDF; a case that still exists owns its directory),
// retries a failure with backoff, survives a crash through its lease, and
// reports a summary that an administrator's retry resets.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. Each test uses user ids of its own and limits
// every processing to them.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";

import { getAuthorizedUpload } from "../../../controllers/protected-uploads.js";
import { createUploadDeletionProcessor } from "../upload-deletion-processor.js";
import { UploadDeletionRequestsStore } from "../upload-deletion-requests.store.js";
import { RETRY_BASE_DELAY_MS } from "../../leased-queue/leased-request-processor.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    return pool;
}

const dbQuery = async (sql, params = []) => (await getPool().query(sql, params)).rows;

test.after(async () => {
    await pool?.end();
});

const silentLogger = { info() {}, warn() {}, error() {} };

function newUserId() {
    return randomInt(100_000_000, 2_000_000_000);
}

function makeRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ethicapp-it-uploads-"));
}

function write(root, relativePath) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, "x");
}

async function insertRequests(userId, entries) {
    for (const { path: requestPath, recursive = false } of entries) {
        await dbQuery(
            "INSERT INTO upload_deletion_requests (user_id, path, recursive) VALUES ($1, $2, $3)",
            [userId, requestPath, recursive]
        );
    }
}

async function requestsOf(userId) {
    return dbQuery(
        `SELECT path, status, attempts, last_error, completed_at IS NOT NULL AS completed
         FROM upload_deletion_requests
         WHERE user_id = $1
         ORDER BY path`,
        [userId]
    );
}

async function insertTeacher() {
    const rows = await dbQuery(
        `INSERT INTO users (name, rut, mail, role)
         VALUES ('IT teacher', $1, $2, 'P')
         RETURNING id`,
        [randomUUID(), `it-877-${randomUUID()}@example.com`]
    );
    return rows[0].id;
}

async function insertCase(creatorId, pdfPath = "pending") {
    const rows = await dbQuery(
        `INSERT INTO ethical_cases (title, pdf_path, creator)
         VALUES ('IT case', $1, $2)
         RETURNING id`,
        [pdfPath, creatorId]
    );
    return rows[0].id;
}

test("V32: deletes the freed files and keeps those a row still references", {
    skip: SKIP_REASON,
}, async () => {
    const root = makeRoot();
    const userId = newUserId();
    const teacherId = await insertTeacher();
    const store = new UploadDeletionRequestsStore({ dbQuery });
    const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

    // A deleted case's directory, a case that still exists, and a deleted
    // case whose PDF another teacher's copy still points to.
    const liveCase = await insertCase(teacherId);
    const sharedPdfCase = 2_000_000_000 - randomInt(1, 1_000_000);
    const deletedCase = sharedPdfCase - 1;
    const sharedPdf = `cases/${sharedPdfCase}/case.pdf`;
    await insertCase(teacherId, `/uploads/${sharedPdf}`);
    for (const file of [
        `cases/${deletedCase}/case.pdf`,
        `cases/${deletedCase}/rendered/page-1.png`,
        `cases/${liveCase}/case.pdf`,
        sharedPdf,
        `user-profiles/${userId}/user-original.jpg`,
    ]) {
        write(root, file);
    }
    await insertRequests(userId, [
        { path: `cases/${deletedCase}`, recursive: true },
        { path: `cases/${liveCase}`, recursive: true },
        { path: sharedPdf },
        { path: `user-profiles/${userId}/user-original.jpg` },
    ]);

    const summary = await processor.processDue({ userId });

    assert.deepEqual(summary, { done: 2, skipped: 2, retrying: 0, failed: 0 });
    assert.equal(fs.existsSync(path.join(root, `cases/${deletedCase}`)), false);
    assert.equal(fs.existsSync(path.join(root, `cases/${liveCase}/case.pdf`)), true);
    assert.equal(fs.existsSync(path.join(root, sharedPdf)), true);
    assert.equal(fs.existsSync(path.join(root, `user-profiles/${userId}`)), false);
    const requests = await requestsOf(userId);
    assert.deepEqual(
        requests.map(request => [request.path, request.status, request.last_error, request.completed]),
        [
            [`cases/${deletedCase}`, "done", null, true],
            [sharedPdf, "skipped", "STILL_REFERENCED", true],
            [`cases/${liveCase}`, "skipped", "STILL_REFERENCED", true],
            [`user-profiles/${userId}/user-original.jpg`, "done", null, true],
        ].sort((left, right) => left[0].localeCompare(right[0]))
    );
    assert.deepEqual(await store.summaryForUser(userId), {
        total: 4, pending: 0, retrying: 0, done: 2, skipped: 2, failed: 0, lastError: null,
    });

    fs.rmSync(root, { recursive: true, force: true });
});

test("V32: a failing deletion is retried with backoff, and an administrator's retry runs it now", {
    skip: SKIP_REASON,
}, async () => {
    const root = makeRoot();
    const userId = newUserId();
    write(root, `user-profiles/${userId}/a.jpg`);
    await insertRequests(userId, [{ path: `user-profiles/${userId}/a.jpg` }]);
    const store = new UploadDeletionRequestsStore({ dbQuery });
    let failing = true;
    const fileSystem = {
        ...fs.promises,
        async rm(target, options) {
            if (failing) {
                throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
            }
            return fs.promises.rm(target, options);
        },
    };
    const processor = createUploadDeletionProcessor({
        store, uploadsRoot: root, fileSystem, logger: silentLogger,
    });

    assert.deepEqual(await processor.processDue({ userId }), { done: 0, skipped: 0, retrying: 1, failed: 0 });
    let [request] = await dbQuery(
        `SELECT status, attempts, last_error,
                EXTRACT(EPOCH FROM (next_attempt_at - now())) * 1000 AS due_in_ms
         FROM upload_deletion_requests WHERE user_id = $1`,
        [userId]
    );
    assert.equal(request.status, "pending");
    assert.equal(request.attempts, 1);
    assert.equal(request.last_error, "FS_EBUSY");
    assert.ok(Number(request.due_in_ms) > RETRY_BASE_DELAY_MS - 5000);
    assert.deepEqual(await store.summaryForUser(userId), {
        total: 1, pending: 0, retrying: 1, done: 0, skipped: 0, failed: 0, lastError: "FS_EBUSY",
    });

    // Not due yet: nothing happens.
    assert.deepEqual(await processor.processDue({ userId }), { done: 0, skipped: 0, retrying: 0, failed: 0 });

    failing = false;
    assert.equal(await store.resetForRetry(userId), 1);
    assert.deepEqual(await processor.processDue({ userId }), { done: 1, skipped: 0, retrying: 0, failed: 0 });
    [request] = await requestsOf(userId);
    assert.equal(request.status, "done");
    assert.equal(fs.existsSync(path.join(root, `user-profiles/${userId}/a.jpg`)), false);
    // A completed request is left alone by the next retry.
    assert.equal(await store.resetForRetry(userId), 0);

    fs.rmSync(root, { recursive: true, force: true });
});

test("V32: an administrator's retry does not delete a directory a render may still be writing", {
    skip: SKIP_REASON,
}, async () => {
    const root = makeRoot();
    const userId = newUserId();
    const directory = `cases/${userId}`;
    write(root, `${directory}/rendered/page-1.png`);
    // As forgetting records the directory of a case whose render is in
    // flight: ten minutes ahead, in both next_attempt_at and not_before.
    await dbQuery(
        `INSERT INTO upload_deletion_requests (user_id, path, recursive, next_attempt_at, not_before)
         VALUES ($1, $2, TRUE, now() + interval '10 minutes', now() + interval '10 minutes')`,
        [userId, directory]
    );
    const store = new UploadDeletionRequestsStore({ dbQuery });
    const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });

    // The retry makes it pending with a fresh backoff, but not due before
    // its not-before time, so nothing is deleted.
    assert.equal(await store.resetForRetry(userId), 1);
    assert.deepEqual(await processor.processDue({ userId }), { done: 0, skipped: 0, retrying: 0, failed: 0 });
    assert.equal(fs.existsSync(path.join(root, directory)), true);
    const [request] = await dbQuery(
        `SELECT status, next_attempt_at >= not_before AS waits
         FROM upload_deletion_requests WHERE user_id = $1`,
        [userId]
    );
    assert.deepEqual(request, { status: "pending", waits: true });

    // A due backoff alone does not make it due either.
    await dbQuery("UPDATE upload_deletion_requests SET next_attempt_at = now() WHERE user_id = $1", [userId]);
    assert.deepEqual(await store.claimDue({ limit: 10, leaseMs: 60_000, userId }), []);

    // Once the not-before time has passed, it is deleted.
    await dbQuery("UPDATE upload_deletion_requests SET not_before = now() WHERE user_id = $1", [userId]);
    assert.deepEqual(await processor.processDue({ userId }), { done: 1, skipped: 0, retrying: 0, failed: 0 });
    assert.equal(fs.existsSync(path.join(root, directory)), false);

    fs.rmSync(root, { recursive: true, force: true });
});

test("V32: another teacher's copy still loads the PDF of a forgotten teacher's case", {
    skip: SKIP_REASON,
}, async () => {
    const forgottenId = await insertTeacher();
    const otherId = await insertTeacher();
    await dbQuery(
        "UPDATE users SET anonymized_at = now(), active = false WHERE id = $1",
        [forgottenId]
    );
    const sourceCase = await insertCase(forgottenId);
    const sourcePdf = `cases/${sourceCase}/case.pdf`;
    await dbQuery(
        "UPDATE ethical_cases SET pdf_path = $2, visibility = 'public' WHERE id = $1",
        [sourceCase, `/uploads/${sourcePdf}`]
    );
    // The copy's PDF copy failed, so it points to the source PDF.
    const copy = await insertCase(otherId, `/uploads/${sourcePdf}`);
    await dbQuery(
        "UPDATE ethical_cases SET original_case_id = $2, imported_from_case_id = $2 WHERE id = $1",
        [copy, sourceCase]
    );
    const query = ({ sql, sqlParams }) => dbQuery(sql, sqlParams);

    const authorized = await getAuthorizedUpload(sourcePdf, { uid: otherId }, query);

    assert.ok(authorized, "the other teacher can still load the PDF");
    // And the deletion of that PDF, were it ever recorded, keeps it.
    const store = new UploadDeletionRequestsStore({ dbQuery });
    assert.equal(await store.isStillReferenced({ path: sourcePdf, recursive: false }), true);
});

test("V32: a deletion cut short by a crash is due again once its lease ends", {
    skip: SKIP_REASON,
}, async () => {
    const root = makeRoot();
    const userId = newUserId();
    await insertRequests(userId, [{ path: `cases/${userId}`, recursive: true }]);
    const store = new UploadDeletionRequestsStore({ dbQuery });

    const claimed = await store.claimDue({ limit: 10, leaseMs: 60_000, userId });
    assert.equal(claimed.length, 1);
    // The process dies here. Another claim finds nothing while the lease lasts.
    assert.deepEqual(await store.claimDue({ limit: 10, leaseMs: 60_000, userId }), []);

    await dbQuery(
        "UPDATE upload_deletion_requests SET next_attempt_at = now() WHERE user_id = $1",
        [userId]
    );
    const processor = createUploadDeletionProcessor({ store, uploadsRoot: root, logger: silentLogger });
    assert.deepEqual(await processor.processDue({ userId }), { done: 1, skipped: 0, retrying: 0, failed: 0 });

    fs.rmSync(root, { recursive: true, force: true });
});
