"use strict";

import express from "express";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import * as config from "../../config/database.config.js";
import { uploadsPath } from "../../config/uploads.config.js";
import { execSQL, param } from "../../db/rest-pg-2.js";
import { requireRole } from "../../helpers/auth-helper.js";
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";
import { avatarUpload, removeUploadedFile } from "../../middleware/upload.js";

const execFileAsync = promisify(execFile);
const router = express.Router();

const uploadsRoot = path.resolve(process.cwd(), uploadsPath);
const AVATAR_MAX_SIZE_BYTES = 500 * 1024;

const allowedMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png"]);
const DEFAULT_PREFERRED_LOCALE = "en_US";

function normalizePreferredLocale(value) {
    return String(value || "").trim().replace("-", "_");
}

async function assertSupportedPreferredLocale(preferredLocale) {
    const normalizedPreferredLocale = normalizePreferredLocale(preferredLocale);
    if (!normalizedPreferredLocale) {
        return DEFAULT_PREFERRED_LOCALE;
    }

    const languages = await execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT code
            FROM languages
            WHERE code = $1
            LIMIT 1
        `,
        sqlParams: [param("plain", normalizedPreferredLocale)]
    });

    if (languages.length === 0) {
        const error = new Error("invalid_preferred_locale");
        error.status = 400;
        throw error;
    }

    return normalizedPreferredLocale;
}


const validateProfileRecaptcha = async (req, res) => {
    const responseKey = req.body?.g_recaptcha_response;
    const recaptchaResult = await RecaptchaHelper.validateRecaptcha(responseKey);

    if (!recaptchaResult) {
        res.status(400).json({ success: false, error: "captcha_error" });
        return false;
    }

    return true;
};

const getAbsoluteUploadPath = (reqFilePath) => {
    if (!reqFilePath) return null;

    const normalized = path.normalize(reqFilePath).replaceAll("\\", "/");
    if (path.isAbsolute(normalized)) {
        return normalized;
    }

    const uploadsPathPrefix = `${uploadsPath.replaceAll("\\", "/").replace(/\/+$/, "")}/`;
    const relativePath = normalized.startsWith(uploadsPathPrefix)
        ? normalized.slice(uploadsPathPrefix.length)
        : normalized;

    return path.resolve(uploadsRoot, relativePath);
};

const buildAvatarPaths = (uid) => {
    const profileUploadsRelativeDir = path.join("user-profiles", String(uid));
    const profileUploadsDir = path.join(uploadsRoot, profileUploadsRelativeDir);
    const baseName = `user-${uid}`;
    const originalFilename = `${baseName}-original.jpg`;
    const topbarFilename = `${baseName}-topbar-64.jpg`;

    return {
        directoryAbsolute: profileUploadsDir,
        originalAbsolute: path.join(profileUploadsDir, originalFilename),
        topbarAbsolute: path.join(profileUploadsDir, topbarFilename),
        originalRelative: `/uploads/${profileUploadsRelativeDir}/${originalFilename}`,
        topbarRelative: `/uploads/${profileUploadsRelativeDir}/${topbarFilename}`
    };
};

router.get("/users/profile", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) return;

    try {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");

        const result = await execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT
                    id,
                    firstname,
                    lastname,
                    name,
                    sex,
                    mail AS email,
                    role,
                    preferred_locale,
                    profile_image_path,
                    profile_image_topbar_path
                FROM users
                WHERE id = $1
                LIMIT 1
            `,
            sqlParams: [param("plain", req.session.uid)]
        });

        if (result.length === 0) {
            return res.status(404).json({ success: false, error: "user_not_found" });
        }

        return res.status(200).json({ success: true, data: result[0] });
    } catch (error) {
        console.error("Error in GET /users/profile:", error);
        return res.status(500).json({ success: false, error: "profile_lookup_failed" });
    }
});

const saveAvatarFile = async (req) => {
    const avatarFile = req.file;
    if (!avatarFile) {
        return null;
    }

    if (!allowedMimeTypes.has(avatarFile.mimetype)) {
        await removeUploadedFile(avatarFile);
        const error = new Error("invalid_avatar_type");
        error.status = 400;
        throw error;
    }

    if (avatarFile.size > AVATAR_MAX_SIZE_BYTES) {
        await removeUploadedFile(avatarFile);
        const error = new Error("avatar_size_limit_exceeded");
        error.status = 400;
        throw error;
    }

    const sourcePath = getAbsoluteUploadPath(avatarFile.path);
    if (!sourcePath) {
        const error = new Error("avatar_upload_failed");
        error.status = 400;
        throw error;
    }

    const avatarPaths = buildAvatarPaths(req.session.uid);
    await fs.promises.mkdir(avatarPaths.directoryAbsolute, { recursive: true });

    await execFileAsync("convert", [
        sourcePath,
        "-auto-orient",
        avatarPaths.originalAbsolute
    ]);

    await execFileAsync("convert", [
        avatarPaths.originalAbsolute,
        "-auto-orient",
        "-thumbnail",
        "64x64^",
        "-gravity",
        "center",
        "-extent",
        "64x64",
        avatarPaths.topbarAbsolute
    ]);

    await execSQL({
        dbcon: config.dbconnString,
        sql: `
            UPDATE users
            SET profile_image_path = $1,
                profile_image_topbar_path = $2
            WHERE id = $3
        `,
        sqlParams: [
            param("plain", avatarPaths.originalRelative),
            param("plain", avatarPaths.topbarRelative),
            param("plain", req.session.uid)
        ]
    });

    await removeUploadedFile(avatarFile);

    return {
        profile_image_path: avatarPaths.originalRelative,
        profile_image_topbar_path: avatarPaths.topbarRelative
    };
};

router.post("/users/profile", avatarUpload, async (req, res) => {
    if (!requireRole(req, res, "P")) return;

    try {
        if (!(await validateProfileRecaptcha(req, res))) {
            await removeUploadedFile(req.file);
            return;
        }

        const firstname = (req.body.firstname || "").trim();
        const lastname = (req.body.lastname || "").trim();
        const sex = (req.body.sex || "").trim().toUpperCase();
        const preferredLocale = Object.hasOwn(req.body, "preferred_locale")
            ? await assertSupportedPreferredLocale(req.body.preferred_locale)
            : null;

        const validSex = new Set(["F", "M", "O"]);
        if (!validSex.has(sex)) {
            return res.status(400).json({ success: false, error: "invalid_sex" });
        }

        const fullName = `${firstname} ${lastname}`.trim();

        await execSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE users
                SET firstname = $1,
                    lastname = $2,
                    sex = $3,
                    name = $4,
                    preferred_locale = COALESCE($5, preferred_locale)
                WHERE id = $6
            `,
            sqlParams: [
                param("plain", firstname),
                param("plain", lastname),
                param("plain", sex),
                param("plain", fullName),
                param("plain", preferredLocale),
                param("plain", req.session.uid)
            ]
        });

        const avatarData = await saveAvatarFile(req);

        return res.status(200).json({
            success: true,
            message: "profile_updated",
            data: {
                ...(avatarData || {}),
                ...(preferredLocale ? { preferred_locale: preferredLocale } : {})
            }
        });
    } catch (error) {
        await removeUploadedFile(req.file);
        console.error("Error in POST /users/profile:", error);
        return res.status(error.status || 500).json({
            success: false,
            error: error.message || "profile_update_failed"
        });
    }
});

router.post("/users/profile/avatar", avatarUpload, async (req, res) => {
    if (!requireRole(req, res, "P")) return;

    try {
        if (!(await validateProfileRecaptcha(req, res))) {
            await removeUploadedFile(req.file);
            return;
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: "avatar_required" });
        }

        const avatarData = await saveAvatarFile(req);

        return res.status(200).json({
            success: true,
            data: avatarData
        });
    } catch (error) {
        await removeUploadedFile(req.file);
        console.error("Error in POST /users/profile/avatar:", error);
        return res.status(error.status || 500).json({
            success: false,
            error: error.message || "avatar_upload_failed"
        });
    }
});

export default router;
