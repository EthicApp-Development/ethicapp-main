import fs from "fs";
import path from "path";

import { uploadsPath } from "../config/uploads.config.js";
import { resolveDeletablePath } from "../services/upload-deletion/upload-deletion-processor.js";
import {
    uploadDeletionRequestsStore,
} from "../services/upload-deletion/upload-deletion-requests.store.js";

/**
 * The files of a deleted case under the protected uploads root (#1010):
 * `cases/<id>/`, with its PDF, rendered pages and manifest. DELETE
 * /cases/:id removes the directory once the case row is gone.
 *
 * The path is resolved with the rules of the upload deletion processor
 * (#877), so it is `cases/<id>` and stays inside the uploads root. The
 * directory is kept when a row still references a path inside it: a copy
 * whose PDF copy failed points to the source case's PDF.
 */

const defaultUploadsRoot = path.resolve(process.cwd(), uploadsPath);

export const CASE_UPLOAD_REMOVAL = Object.freeze({
    REMOVED: "removed",
    KEPT:    "kept",
    INVALID: "invalid",
    FAILED:  "failed",
});

/**
 * Removes the upload directory of a deleted case. It never throws: a
 * failure is logged, and the caller's answer does not depend on it.
 *
 * @param {number} caseId - The deleted case, a positive integer.
 * @param {Object} [options]
 * @param {string} [options.uploadsRoot] - Absolute uploads root.
 * @param {Object} [options.fileSystem] - fs.promises, or a fake.
 * @param {(request: {path: string, recursive: boolean}) => Promise<boolean>}
 *     [options.isStillReferenced] - Whether a row still references the path.
 * @param {Object} [options.logger]
 * @returns {Promise<string>} One of CASE_UPLOAD_REMOVAL.
 */
export async function removeCaseUploadDirectory(caseId, {
    uploadsRoot = defaultUploadsRoot,
    fileSystem = fs.promises,
    isStillReferenced = request => uploadDeletionRequestsStore.isStillReferenced(request),
    logger = console,
} = {}) {
    const request = { path: `cases/${caseId}`, recursive: true };
    const absolutePath = Number.isSafeInteger(caseId) && caseId > 0
        ? resolveDeletablePath(path.resolve(uploadsRoot), request)
        : null;
    if (!absolutePath) {
        logger.error("Refusing to remove the upload directory of a deleted case.", { caseId });
        return CASE_UPLOAD_REMOVAL.INVALID;
    }

    try {
        if (await isStillReferenced(request)) {
            logger.info("Keeping the upload directory of a deleted case that a row references.", {
                caseId,
            });
            return CASE_UPLOAD_REMOVAL.KEPT;
        }

        await fileSystem.rm(absolutePath, { recursive: true, force: true });
        return CASE_UPLOAD_REMOVAL.REMOVED;
    } catch (error) {
        logger.error("Unable to remove the upload directory of a deleted case.", {
            caseId,
            error: error?.message,
        });
        return CASE_UPLOAD_REMOVAL.FAILED;
    }
}
