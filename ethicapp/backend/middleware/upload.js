import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import * as config from "../config/config.js";

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const PDF_MIME_TYPES = new Set(["application/pdf"]);
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);
const uploadsRoot = path.resolve(process.cwd(), config.uploadsPath);

function sanitizeFilename(filename) {
    return path.basename(filename || "upload").replace(/[^\w.-]/g, "_");
}

function createStorage() {
    return multer.diskStorage({
        destination(req, file, callback) {
            const uploadId = crypto.randomUUID();
            const destination = path.join(uploadsRoot, "tmp", uploadId, file.fieldname);

            fs.mkdir(destination, { recursive: true }, (error) => {
                callback(error, destination);
            });
        },
        filename(req, file, callback) {
            callback(null, sanitizeFilename(file.originalname));
        },
    });
}

function createFileFilter(allowedMimeTypes) {
    return (req, file, callback) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            const error = new Error("Invalid file type.");
            error.status = 400;
            return callback(error);
        }

        return callback(null, true);
    };
}

function createUpload(allowedMimeTypes) {
    return multer({
        storage: createStorage(),
        fileFilter: createFileFilter(allowedMimeTypes),
        limits: {
            fileSize: MAX_UPLOAD_SIZE_BYTES,
        },
    });
}

function withUpload(uploadMiddleware) {
    return (req, res, next) => {
        uploadMiddleware(req, res, (error) => {
            if (!error) {
                return next();
            }

            const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
            return res.status(status).json({
                status: "err",
                message: error.message || "File upload failed.",
            });
        });
    };
}

function getRelativeUploadPath(publicPath) {
    const normalizedPath = String(publicPath || "").replaceAll("\\", "/").replace(/^\/+/, "");

    if (normalizedPath.startsWith("assets/uploads/")) {
        return normalizedPath.slice("assets/uploads/".length);
    }

    if (normalizedPath.startsWith("uploads/")) {
        return normalizedPath.slice("uploads/".length);
    }

    throw new Error(`Invalid upload public path: ${publicPath}`);
}

export async function moveUploadedFile(uploadedFile, publicPath) {
    if (!uploadedFile?.path) {
        throw new Error("Missing uploaded file path.");
    }

    const destination = path.join(uploadsRoot, getRelativeUploadPath(publicPath));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.rm(destination, { force: true });
    await fs.promises.rename(uploadedFile.path, destination);
    uploadedFile.path = destination;

    return publicPath;
}

export async function removeUploadedFile(uploadedFile) {
    if (!uploadedFile?.path) {
        return;
    }

    try {
        await fs.promises.unlink(uploadedFile.path);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.warn("Unable to remove temporary uploaded file:", error);
        }
    }
}

export const pdfUpload = withUpload(createUpload(PDF_MIME_TYPES).single("pdf"));
export const avatarUpload = withUpload(createUpload(IMAGE_MIME_TYPES).single("avatar"));
