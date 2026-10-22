import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { mountStaticAssets } from "../static-assets.js";

// A frontend tree with the files the UI needs and the files it must not expose.
const frontendRoot = path.join(os.tmpdir(), `ethicapp-static-test-${crypto.randomUUID()}`);
const assetsRoot = path.join(frontendRoot, "assets");
const files = {
    "package.json":                          "{}",
    "package-lock.json":                     "{}",
    "assets/css/dist/assets-bundle.css":     "@import '../main.css';",
    "assets/css/main.css":                   "body{}",
    "assets/css/styles.scss":                "$x: 1;",
    "assets/js/dist/teacher-admin.js":       "bundle",
    "assets/js/dist/teacher-admin.js.map":   "{}",
    "assets/js/services/secret.service.js":  "source",
    "assets/js/common-ethicapp-deps.js":     "source",
    "assets/images/cards/create-case.jpg":   "jpg",
    "assets/static/views/teacher/home.html": "<p>home</p>",
    "assets/static/views/teacher/notes.txt": "notes",
    "assets/locales/en_US.json":             "{}",
    "assets/locales/.env":                   "SECRET=1",
    "assets/fontawesome/css/all.min.css":    "fa",
    "assets/fontawesome/webfonts/fa.woff2":  "font",
    "assets/fontawesome/LICENSE.txt":        "license",
    "assets/webfonts/Avenir-Book.woff2":     "font",
    "assets/uploads/abc/pdf/case.pdf":       "pdf",
};

let server;
let baseUrl;

before(async () => {
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(frontendRoot, relativePath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content);
    }

    const app = express();
    mountStaticAssets(app, assetsRoot);
    app.use((req, res) => res.status(404).send("not found"));

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(frontendRoot, { recursive: true, force: true });
});

async function statusOf(urlPath) {
    const response = await fetch(`${baseUrl}${urlPath}`);
    await response.arrayBuffer();
    return response.status;
}

describe("static assets", () => {
    it("serves the files the teacher UI loads", async () => {
        for (const urlPath of [
            "/assets/css/dist/assets-bundle.css",
            "/assets/css/main.css",
            "/assets/js/dist/teacher-admin.js",
            "/assets/js/dist/teacher-admin.js.map",
            "/assets/images/cards/create-case.jpg",
            "/assets/static/views/teacher/home.html",
            "/static/views/teacher/home.html",
            "/assets/locales/en_US.json",
            "/assets/fontawesome/css/all.min.css",
            "/assets/fontawesome/webfonts/fa.woff2",
            "/assets/webfonts/Avenir-Book.woff2",
        ]) {
            assert.equal(await statusOf(urlPath), 200, urlPath);
        }
    });

    it("does not serve package files, sources, uploads or other file types", async () => {
        for (const urlPath of [
            "/package.json",
            "/package-lock.json",
            "/assets/package.json",
            "/assets/css/styles.scss",
            "/assets/js/services/secret.service.js",
            "/assets/js/common-ethicapp-deps.js",
            "/js/dist/teacher-admin.js",
            "/css/main.css",
            "/assets/static/views/teacher/notes.txt",
            "/assets/locales/.env",
            "/assets/fontawesome/LICENSE.txt",
            "/assets/uploads/abc/pdf/case.pdf",
            "/uploads/abc/pdf/case.pdf",
            "/assets/js/dist/../services/secret.service.js",
            "/assets/css/..%2fjs%2fservices%2fsecret.service.js",
        ]) {
            assert.equal(await statusOf(urlPath), 404, urlPath);
        }
    });
});
