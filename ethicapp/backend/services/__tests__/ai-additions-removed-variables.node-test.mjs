// The AI Additions URLs come from the stored connection (#814). The variables
// that used to carry them must not come back: not in the backend code, nor,
// when the repository is available (not inside the Docker test stage), in the
// environment contract, the examples or the Compose files. INSTALL.md is not
// scanned: its upgrade note names them so operators can delete them.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REMOVED_VARIABLES = Object.freeze([
    "AI_ADDITIONS_BASE_URL",
    "AI_ADDITIONS_KEYCLOAK_BASE_URL",
    "AI_ADDITIONS_KEYCLOAK_TOKEN_URL",
    "AI_ADDITIONS_POLYADIC_AGENTS_API_BASE_URL",
    "AI_ADDITIONS_ARGUMENTATION_TUTOR_API_BASE_URL",
    "AI_ADDITIONS_CASE_ANALYST_API_BASE_URL",
    "EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER",
    "EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL",
]);
const PATTERN = new RegExp(`\\b(?:${REMOVED_VARIABLES.join("|")})\\b`, "u");

const THIS_FILE = fileURLToPath(import.meta.url);
const BACKEND_DIR = path.resolve(path.dirname(THIS_FILE), "../..");
const REPOSITORY_DIR = path.resolve(BACKEND_DIR, "../..");
const REPOSITORY_FILES = [
    "deploy/env.contract.yml",
    "ethicapp/.env.example",
    ".env.example",
    ".env.shared.example",
    "docker-compose.yml",
    "docker-compose.prod.yml",
];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".sh"]);

async function listSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === "node_modules" || entry.name === "uploads" ? [] : listSourceFiles(fullPath);
        }
        return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
    }));
    return files.flat();
}

async function offendingLines(files) {
    const offenders = [];
    for (const file of files) {
        const lines = (await readFile(file, "utf8")).split("\n");
        lines.forEach((line, index) => {
            if (PATTERN.test(line)) {
                offenders.push(`${path.relative(REPOSITORY_DIR, file)}:${index + 1}: ${line.trim()}`);
            }
        });
    }
    return offenders;
}

test("the backend reads no removed AI Additions URL variable", async () => {
    const files = (await listSourceFiles(BACKEND_DIR)).filter(file => file !== THIS_FILE);

    assert.deepEqual(await offendingLines(files), []);
});

test("the contract, examples and Compose files list no removed variable", async (t) => {
    const files = REPOSITORY_FILES
        .map(file => path.join(REPOSITORY_DIR, file))
        .filter(file => existsSync(file));
    if (files.length === 0) {
        t.skip("repository files are not available (Docker test stage)");
        return;
    }

    assert.deepEqual(await offendingLines(files), []);
});
