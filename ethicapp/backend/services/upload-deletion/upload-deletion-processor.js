import fs from "fs";
import path from "path";

import { uploadsPath } from "../../config/uploads.config.js";
import { createLeasedRequestProcessor } from "../leased-queue/leased-request-processor.js";
import { uploadDeletionRequestsStore } from "./upload-deletion-requests.store.js";

/**
 * Background deletion of the upload files that forgetting an account freed
 * (#877, upload_deletion_requests, V32), with the claim, lease and backoff of
 * createLeasedRequestProcessor. It runs inside the ethicapp web process,
 * which serves the protected uploads volume; the management console, which
 * records the requests, does not mount it.
 *
 * For each request:
 * - the path must be one ethicapp may delete: relative, without `.` or `..`
 *   segments, under `cases/` or `user-profiles/`, resolving inside the
 *   uploads root, also once symbolic links in its parent are resolved; a
 *   directory only as `cases/<id>`. Anything else fails (INVALID_PATH);
 * - a path that a row still references (a copy whose PDF copy failed points
 *   to the source case's PDF, for example) is kept, and the request ends
 *   `skipped` with STILL_REFERENCED;
 * - otherwise the path is removed (a missing path counts as removed), and
 *   then the directories it leaves empty, up to the top-level folder;
 * - a file system error is retried with backoff (FS_EACCES, FS_EBUSY, ...),
 *   except those a retry cannot fix (FS_EISDIR, FS_ENOTDIR, ...).
 */

export const DELETABLE_TOP_LEVEL_DIRECTORIES = Object.freeze(["cases", "user-profiles"]);

const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const CASE_DIRECTORY_PATTERN = /^cases\/[1-9][0-9]{0,9}$/;
const PERMANENT_FS_ERRORS = new Set(["EISDIR", "ENOTDIR", "ELOOP", "ENAMETOOLONG", "EINVAL"]);

function isInside(candidatePath, parentDirectory) {
    const relativePath = path.relative(parentDirectory, candidatePath);
    return Boolean(relativePath)
        && !relativePath.startsWith("..")
        && !path.isAbsolute(relativePath);
}

/**
 * The absolute path of a request, or null when it is not one ethicapp may
 * delete. Checks the text only; symbolic links are checked when deleting.
 * @param {string} uploadsRoot - Absolute uploads root.
 * @param {{ path: string, recursive: boolean }} request
 * @returns {string|null}
 */
export function resolveDeletablePath(uploadsRoot, { path: relativePath, recursive }) {
    if (typeof relativePath !== "string" || relativePath.length > 512) {
        return null;
    }

    const segments = relativePath.split("/");
    if (
        segments.length < 2 ||
        !DELETABLE_TOP_LEVEL_DIRECTORIES.includes(segments[0]) ||
        segments.some(segment => !SEGMENT_PATTERN.test(segment) || /^\.{1,2}$/.test(segment))
    ) {
        return null;
    }

    if (recursive && !CASE_DIRECTORY_PATTERN.test(relativePath)) {
        return null;
    }

    const absolutePath = path.resolve(uploadsRoot, ...segments);
    const topLevelDirectory = path.join(uploadsRoot, segments[0]);
    return isInside(absolutePath, topLevelDirectory) ? absolutePath : null;
}

/**
 * The code an error is recorded with, and whether a retry may fix it.
 * @returns {{ code: string, retryable: boolean }}
 */
export function classifyFileSystemError(error) {
    const rawCode = String(error?.code || "").replace(/^ERR_FS_/, "");
    const normalized = rawCode.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 48);
    if (!normalized) {
        return { code: "FS_ERROR", retryable: true };
    }
    return { code: `FS_${normalized}`, retryable: !PERMANENT_FS_ERRORS.has(normalized) };
}

function errorOutcome(classification) {
    return { outcome: "error", ...classification };
}

/**
 * @param {Object} [options]
 * @param {Object} [options.store] - An UploadDeletionRequestsStore.
 * @param {string} [options.uploadsRoot] - The uploads root; by default the
 *     one the protected uploads controller serves.
 * @param {Object} [options.fileSystem] - fs.promises, or a fake.
 */
export function createUploadDeletionProcessor({
    store = uploadDeletionRequestsStore,
    uploadsRoot = path.resolve(process.cwd(), uploadsPath),
    fileSystem = fs.promises,
    logger = console,
    intervalMs,
    batchSize,
    leaseMs,
    timers,
} = {}) {
    const root = path.resolve(uploadsRoot);

    // The real parent directory of a path, or null when it does not exist.
    async function realParentDirectory(absolutePath) {
        try {
            return await fileSystem.realpath(path.dirname(absolutePath));
        } catch (error) {
            if (error?.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    }

    // Removes the directories a deleted file leaves empty, up to the
    // top-level folder (`user-profiles/5` once its images are gone).
    async function pruneEmptyParents(absolutePath, topLevelDirectory) {
        let directory = path.dirname(absolutePath);

        while (isInside(directory, topLevelDirectory)) {
            try {
                await fileSystem.rmdir(directory);
            } catch {
                return;
            }
            directory = path.dirname(directory);
        }
    }

    async function attempt(request) {
        const absolutePath = resolveDeletablePath(root, request);
        if (!absolutePath) {
            return errorOutcome({ code: "INVALID_PATH", retryable: false });
        }

        if (await store.isStillReferenced(request)) {
            return { outcome: "skipped", code: "STILL_REFERENCED" };
        }

        try {
            const realRoot = await fileSystem.realpath(root);
            const parent = await realParentDirectory(absolutePath);
            if (parent === null) {
                return { outcome: "done" };
            }

            const realTopLevel = path.join(realRoot, request.path.split("/")[0]);
            const realTarget = path.join(parent, path.basename(absolutePath));
            if (!isInside(realTarget, realTopLevel)) {
                return errorOutcome({ code: "INVALID_PATH", retryable: false });
            }

            await fileSystem.rm(realTarget, { recursive: request.recursive, force: true });
            if (!request.recursive) {
                await pruneEmptyParents(realTarget, realTopLevel);
            }
        } catch (error) {
            return errorOutcome(classifyFileSystemError(error));
        }

        return { outcome: "done" };
    }

    return createLeasedRequestProcessor({
        label:       "[upload-deletion]",
        store,
        attempt,
        describe:    request => `Upload deletion ${request.id}`,
        summaryKeys: ["done", "skipped", "retrying", "failed"],
        logger,
        intervalMs,
        batchSize,
        leaseMs,
        timers,
    });
}
