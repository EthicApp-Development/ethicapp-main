import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { dbconnString, uploadsPath } from "../config/config.js";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "../..");

export const defaultSeedDir = path.join(repoRoot, "database/seeds/canonical-activities");
export const defaultManifestPath = path.join(defaultSeedDir, "manifest.json");
export const defaultAssetsDir = path.join(defaultSeedDir, "assets");
export const uploadsRoot = path.resolve(backendRoot, uploadsPath);

export function createPool() {
    return new Pool({
        connectionString: process.env.DATABASE_URL || process.env.DB_CONNECTION_STRING || dbconnString,
    });
}

export function parseArgs(argv) {
    return argv.reduce((acc, arg) => {
        if (!arg.startsWith("--")) {
            return acc;
        }

        const [key, ...valueParts] = arg.slice(2).split("=");
        acc[key] = valueParts.length > 0 ? valueParts.join("=") : true;
        return acc;
    }, {});
}

export function parseIdList(value) {
    if (!value) {
        return [];
    }

    return String(value)
        .split(",")
        .map(item => Number(item.trim()))
        .filter(value => Number.isInteger(value) && value > 0);
}

export function slugify(value, fallback = "canonical-activity") {
    const slug = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || fallback;
}

export function getDesignTitle(design, fallback) {
    return design?.metainfo?.title || design?.title || fallback;
}

export function publicUploadPathToFilePath(pdfPath) {
    if (!pdfPath || typeof pdfPath !== "string") {
        return null;
    }

    if (!pdfPath.startsWith("/uploads/")) {
        return null;
    }

    return path.join(uploadsRoot, pdfPath.replace(/^\/uploads\//, ""));
}

export async function copyFileIfExists(source, destination) {
    try {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
        return true;
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }

        throw error;
    }
}
