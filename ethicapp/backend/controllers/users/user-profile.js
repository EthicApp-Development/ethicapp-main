"use strict";

import express from "express";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import * as config from "../../config/config.js";
import { execSQL, param } from "../../db/rest-pg-2.js";
import { requireRole } from "../../helpers/auth-helper.js";
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";

const execFileAsync = promisify(execFile);
const router = express.Router();

const uploadsRoot = path.resolve(process.cwd(), config.uploadsPath);
const profileUploadsRelativeDir = path.join("user-profile");
const profileUploadsDir = path.join(uploadsRoot, profileUploadsRelativeDir);
const AVATAR_MAX_SIZE_BYTES = 300 * 1024;

const allowedMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png"]);


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

    const normalized = path.normalize(reqFilePath);
    if (path.isAbsolute(normalized)) {
        return normalized;
    }

    return path.resolve(process.cwd(), normalized);
};

const buildAvatarPaths = (uid) => {
    const baseName = `user-${uid}`;
    const originalFilename = `${baseName}-original.jpg`;
    const topbarFilename = `${baseName}-topbar-64.jpg`;

    return {
        originalAbsolute: path.join(profileUploadsDir, originalFilename),
        topbarAbsolute: path.join(profileUploadsDir, topbarFilename),
        originalRelative: `/uploads/${profileUploadsRelativeDir}/${originalFilename}`,
        topbarRelative: `/uploads/${profileUploadsRelativeDir}/${topbarFilename}`
    };
};

router.get("/users/profile", async (req, res) => {
    if (!requireRole(req, res, "P")) return;

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
                    lang,
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

router.post("/users/profile", async (req, res) => {
    if (!requireRole(req, res, "P")) return;

    try {
        if (!(await validateProfileRecaptcha(req, res))) return;

        const firstname = (req.body.firstname || "").trim();
        const lastname = (req.body.lastname || "").trim();
        const sex = (req.body.sex || "").trim().toUpperCase();

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
                    name = $4
                WHERE id = $5
            `,
            sqlParams: [
                param("plain", firstname),
                param("plain", lastname),
                param("plain", sex),
                param("plain", fullName),
                param("plain", req.session.uid)
            ]
        });

        return res.status(200).json({ success: true, message: "profile_updated" });
    } catch (error) {
        console.error("Error in POST /users/profile:", error);
        return res.status(500).json({ success: false, error: "profile_update_failed" });
    }
});

router.post("/users/profile/avatar", async (req, res) => {
    if (!requireRole(req, res, "P")) return;

    try {
        if (!(await validateProfileRecaptcha(req, res))) return;

        const avatarFile = req.files?.avatar;
        if (!avatarFile) {
            return res.status(400).json({ success: false, error: "avatar_required" });
        }

        if (!allowedMimeTypes.has(avatarFile.mimetype)) {
            return res.status(400).json({ success: false, error: "invalid_avatar_type" });
        }

        if (avatarFile.size > AVATAR_MAX_SIZE_BYTES) {
            return res.status(400).json({ success: false, error: "avatar_size_limit_exceeded" });
        }

        const sourcePath = getAbsoluteUploadPath(avatarFile.file);
        if (!sourcePath) {
            return res.status(400).json({ success: false, error: "avatar_upload_failed" });
        }

        const avatarPaths = buildAvatarPaths(req.session.uid);
        await fs.promises.mkdir(profileUploadsDir, { recursive: true });

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

        return res.status(200).json({
            success: true,
            data: {
                profile_image_path: avatarPaths.originalRelative,
                profile_image_topbar_path: avatarPaths.topbarRelative
            }
        });
    } catch (error) {
        console.error("Error in POST /users/profile/avatar:", error);
        return res.status(500).json({ success: false, error: "avatar_upload_failed" });
    }
});

export default router;
