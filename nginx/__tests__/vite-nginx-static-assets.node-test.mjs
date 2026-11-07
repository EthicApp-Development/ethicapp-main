// The Vite plugin that serves nginx/static under `vite` and `vite preview`
// (#999) must agree with NGINX, and must serve nothing else:
//
// - the three SPAs keep byte-identical copies of the plugin;
// - for every file in nginx/static/{fonts,favicon,logos}, at the root and
//   under each SPA prefix, both NGINX configurations select a location that
//   serves the same file the plugin does, so a pattern added on one side only
//   fails here;
// - the middleware serves those files with their content type, refuses paths
//   that leave the three directories (decoded or not, with backslashes, NUL
//   bytes or symbolic links), and leaves every other request to Vite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CONFIGS, selectLocation, serverLocations } from "./nginx-locations.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATIC_ROOT = path.join(REPO_ROOT, "nginx/static");
const NGINX_STATIC_ROOT = "/usr/share/nginx/html/static";
const SPAS = ["auth-backend/frontend", "management-console/frontend", "ethicapp-student/frontend"];
const PLUGIN_PATHS = SPAS.map(spa => path.join(REPO_ROOT, spa, "vite/nginx-static-assets.js"));
const PREFIXES = ["", "/auth", "/student", "/mng"];

const plugin = await import(PLUGIN_PATHS[0]);
const { NGINX_STATIC_ROUTES, createNginxStaticMiddleware, resolveNginxStaticFile } = plugin;
const nginxStaticAssets = plugin.default;

function filesIn(directory) {
    return fs.readdirSync(path.join(STATIC_ROOT, directory), { recursive: true })
        .map(entry => path.join(directory, entry))
        .filter(relative => fs.statSync(path.join(STATIC_ROOT, relative)).isFile());
}

// Every URL the SPAs may request for a file, at the root and under each SPA
// prefix: the forms NGINX serves.
function urlsFor(relative) {
    const [directory, ...rest] = relative.split(path.sep);
    const file = rest.join("/");
    const paths = {
        fonts:   [`/static/fonts/${file}`],
        favicon: [`/favicon/${file}`],
        logos:   [`/images/logos/${file}`, `/assets/images/logos/${file}`],
    }[directory];
    if (directory === "favicon" && /^(favicon\.ico|favicon\.svg|apple-touch-icon\.png|site\.webmanifest)$/u.test(file)) {
        paths.push(`/${file}`);
    }
    return PREFIXES.flatMap(prefix => paths.map(url => `${prefix}${url}`));
}

const SERVED_FILES = ["fonts", "favicon", "logos"].flatMap(filesIn);

// The file NGINX serves for a URI from the location it selects, as a path
// under nginx/static, or null when that location serves no static file.
function nginxFile(location, uri) {
    const alias = location.directives.find(directive => directive.name === "alias")?.args[0];
    const root = location.directives.find(directive => directive.name === "root")?.args[0];
    let served = null;
    if (alias && location.modifier.startsWith("~")) {
        const match = new RegExp(location.pattern, location.modifier === "~*" ? "iu" : "u").exec(uri);
        served = alias.replace(/\$(\d)/gu, (_, group) => match[Number(group)]);
    } else if (alias) {
        served = alias + uri.slice(location.pattern.length);
    } else if (root) {
        served = root + uri;
    }
    if (!served?.startsWith(`${NGINX_STATIC_ROOT}/`)) {
        return null;
    }
    return served.slice(NGINX_STATIC_ROOT.length + 1);
}

function pluginFile(uri) {
    const file = resolveNginxStaticFile(STATIC_ROOT, uri);
    return file ? path.relative(fs.realpathSync(STATIC_ROOT), file).split(path.sep).join("/") : file;
}

// Runs the middleware for one request; resolves to { status, headers, body }
// or "next" when it leaves the request to Vite.
function request(middleware, url, method = "GET") {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const headers = {};
        const res = {
            statusCode: 200,
            setHeader(name, value) {
                headers[name.toLowerCase()] = String(value);
            },
            write(chunk) {
                chunks.push(Buffer.from(chunk));
                return true;
            },
            end(chunk) {
                if (chunk) {
                    chunks.push(Buffer.from(chunk));
                }
                resolve({ status: this.statusCode, headers, body: Buffer.concat(chunks) });
            },
            on() {
                return this;
            },
            once() {
                return this;
            },
            emit() {
                return true;
            },
        };
        try {
            middleware({ method, url }, res, () => resolve("next"));
        } catch (error) {
            reject(error);
        }
    });
}

describe("the Vite plugin for nginx/static (#999)", () => {
    it("is identical in the three SPAs", () => {
        const [first, ...others] = PLUGIN_PATHS.map(file => fs.readFileSync(file, "utf8"));
        for (const [index, other] of others.entries()) {
            assert.equal(other, first, `${PLUGIN_PATHS[index + 1]} differs from ${PLUGIN_PATHS[0]}`);
        }
    });

    it("is wired into the three SPAs' Vite configurations", () => {
        for (const spa of SPAS) {
            const config = fs.readFileSync(path.join(REPO_ROOT, spa, "vite.config.js"), "utf8");
            assert.match(config, /import nginxStaticAssets from '\.\/vite\/nginx-static-assets\.js';/u, spa);
            assert.match(config, /plugins: \[[^\]]*nginxStaticAssets\(\)/u, spa);
        }
    });

    it("runs on the dev and preview servers only", () => {
        const instance = nginxStaticAssets();
        assert.equal(instance.apply, "serve");
        assert.equal(typeof instance.configureServer, "function");
        assert.equal(typeof instance.configurePreviewServer, "function");
    });

    it("covers the fonts, favicons, manifest and logos", () => {
        assert.ok(SERVED_FILES.includes(path.join("fonts", "nunito", "nunito.css")));
        assert.ok(SERVED_FILES.includes(path.join("favicon", "site.webmanifest")));
        assert.ok(SERVED_FILES.includes(path.join("logos", "ethicapp-logo.svg")));
        assert.equal(NGINX_STATIC_ROUTES.length, 4);
    });

    for (const config of CONFIGS) {
        it(`serves each file from the same place as ${config}`, () => {
            const locations = serverLocations(config);
            for (const relative of SERVED_FILES) {
                const expected = relative.split(path.sep).join("/");
                for (const uri of urlsFor(relative)) {
                    const location = selectLocation(locations, uri);
                    assert.ok(location, `${config} has no location for ${uri}`);
                    assert.equal(nginxFile(location, uri), expected,
                        `${config} serves ${uri} from \`location ${location.modifier} ${location.pattern}\``);
                    assert.equal(pluginFile(uri), expected, `the plugin serves ${uri}`);
                }
            }
        });
    }
});

describe("the nginx/static middleware", () => {
    const middleware = createNginxStaticMiddleware(STATIC_ROOT);

    it("serves each kind of file with its content type", async () => {
        const cases = {
            "/auth/static/fonts/nunito/nunito.css":       "text/css; charset=utf-8",
            "/static/fonts/nunito/Nunito-Regular.woff2":  "font/woff2",
            "/favicon.ico":                               "image/x-icon",
            "/student/favicon.svg":                       "image/svg+xml",
            "/mng/site.webmanifest":                      "application/manifest+json",
            "/favicon/favicon-96x96.png":                 "image/png",
            "/images/logos/ethicapp-logo.svg?v=1":        "image/svg+xml",
        };
        for (const [url, contentType] of Object.entries(cases)) {
            const response = await request(middleware, url);
            assert.equal(response.status, 200, url);
            assert.equal(response.headers["content-type"], contentType, url);
            const file = resolveNginxStaticFile(STATIC_ROOT, url.split("?")[0]);
            assert.deepEqual(response.body, fs.readFileSync(file), url);
            assert.equal(response.headers["content-length"], String(response.body.length), url);
        }
    });

    it("answers HEAD without a body", async () => {
        const response = await request(middleware, "/favicon.svg", "HEAD");
        assert.equal(response.status, 200);
        assert.equal(response.body.length, 0);
        assert.ok(Number(response.headers["content-length"]) > 0);
    });

    it("leaves other paths and methods to Vite", async () => {
        for (const url of ["/", "/auth/", "/auth/src/main.jsx", "/static/other/x.css", "/favicon.png",
            "/images/other/logo.svg", "/student/assets/index.js", "/%E0%A4%A"]) {
            assert.equal(await request(middleware, url), "next", url);
        }
        assert.equal(await request(middleware, "/favicon.svg", "POST"), "next");
    });

    it("answers 404 for a missing file or a path that leaves the static directories", async () => {
        for (const url of [
            "/favicon/missing.png",
            "/favicon/../errors/unavailable.html",
            "/favicon/%2e%2e/errors/unavailable.html",
            "/auth/favicon/..%2F..%2F..%2Fpackage.json",
            "/static/fonts/..%2f..%2fmaintenance/index.html",
            "/images/logos/..%5C..%5Cerrors%5Cunavailable.html",
            "/images/logos/ethicapp-logo.svg%00.png",
            "/favicon/.",
            "/static/fonts/nunito",
        ]) {
            const response = await request(middleware, url);
            assert.equal(response === "next" ? "next" : response.status, 404, url);
        }
    });

    describe("with symbolic links", () => {
        let root = null;

        before(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), "nginx-static-"));
            fs.mkdirSync(path.join(root, "favicon"));
            fs.mkdirSync(path.join(root, "logos"));
            fs.writeFileSync(path.join(root, "secret.txt"), "outside");
            fs.writeFileSync(path.join(root, "logos", "logo.svg"), "<svg/>");
            fs.symlinkSync(path.join(root, "secret.txt"), path.join(root, "favicon", "leak.txt"));
            fs.symlinkSync(path.join(root, "logos", "logo.svg"), path.join(root, "favicon", "inside.svg"));
        });

        after(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        it("refuses a link that leaves its directory, even into another served one", async () => {
            const linked = createNginxStaticMiddleware(root);
            assert.equal((await request(linked, "/favicon/leak.txt")).status, 404);
            assert.equal((await request(linked, "/favicon/inside.svg")).status, 404);
            assert.equal((await request(linked, "/images/logos/logo.svg")).status, 200);
        });
    });

    it("installs nothing when nginx/static is not there", () => {
        const used = [];
        const server = { middlewares: { use: handler => used.push(handler) } };
        nginxStaticAssets({ staticRoot: path.join(os.tmpdir(), "no-such-nginx-static") }).configureServer(server);
        assert.deepEqual(used, []);
        nginxStaticAssets({ staticRoot: STATIC_ROOT }).configurePreviewServer(server);
        assert.equal(used.length, 1);
    });
});
