import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { dbconnString } from "../config/database.config.js";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "../..");

export const defaultTagTaxonomySeedDir = path.join(repoRoot, "database/seeds/tag-taxonomies");

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

export async function listTaxonomySeedFiles(seedDir) {
    let entries = [];
    try {
        entries = await fs.readdir(seedDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }

        throw error;
    }

    return entries
        .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
        .map(entry => path.join(seedDir, entry.name))
        .sort();
}
