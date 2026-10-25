import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseGoogleDocumentUrl } from "../../../common/modules/google-document-urls.js";
import {
    MAX_TITLE_SCAN_BYTES,
    cacheKey,
    createGoogleDocumentAvailabilityService,
    decodeHtmlEntities,
    publishedDocumentName,
    resolveCacheTtlSeconds,
    resolveTimeoutMs,
} from "../google-document-availability.service.js";

const NOW = 1_800_000_000_000;
const API_KEY = "test-api-key-AIzaSyNeverLogged";
const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const OTHER_FILE_ID = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210";
const PUBLISHED_ID = "2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const DRIVE_API_URL = `https://www.googleapis.com/drive/v3/files/${FILE_ID}`
    + "?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true";
const MODIFIED_TIME = "2026-10-20T12:00:00.000Z";
const SLIDES_BASE = "https://docs.google.com/presentation/d";

const docLink = parseGoogleDocumentUrl(`https://docs.google.com/document/d/${FILE_ID}/edit`);
const driveLink = parseGoogleDocumentUrl(`https://drive.google.com/file/d/${FILE_ID}/view`);
const publishedSheet = parseGoogleDocumentUrl(
    `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`
);
const publishedDoc = parseGoogleDocumentUrl(
    `https://docs.google.com/document/d/e/${PUBLISHED_ID}/pub`
);

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function html(status, body) {
    return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

function redirect(location, status = 302) {
    return new Response(null, { status, headers: { Location: location } });
}

function driveError(status, reason) {
    return json(status, { error: { code: status, errors: [{ reason }] } });
}

function driveFile(overrides = {}) {
    return {
        id:           FILE_ID,
        name:         "Case reading",
        mimeType:     "application/vnd.google-apps.document",
        modifiedTime: MODIFIED_TIME,
        ...overrides,
    };
}

// A fake fetch: `handler(url, options)` answers each request, all recorded.
function makeFetch(handler) {
    const calls = [];
    async function fetch(url, options = {}) {
        calls.push({ url: String(url), options });
        return handler(String(url), options);
    }
    fetch.calls = calls;
    return fetch;
}

// Routes Drive API calls and anonymous probes to separate answers.
function routedFetch({ api, probe }) {
    return makeFetch((url, options) => {
        const answer = url.startsWith("https://www.googleapis.com/") ? api : probe;
        return typeof answer === "function" ? answer(url, options) : answer;
    });
}

// A fake ioredis cache: string values, TTLs recorded, optional failures.
function makeCache({ failReads = false, failWrites = false, hang = false } = {}) {
    const store = new Map();
    const ttls = new Map();
    const calls = { mget: [], set: [] };
    return {
        store,
        ttls,
        calls,
        async mget(...keys) {
            calls.mget.push(keys);
            if (hang) {
                return new Promise(() => {});
            }
            if (failReads) {
                throw new Error("Connection is closed.");
            }
            return keys.map((key) => store.get(key) ?? null);
        },
        async set(key, value, mode, ttl) {
            calls.set.push({ key, value, mode, ttl });
            if (failWrites) {
                throw new Error("Connection is closed.");
            }
            store.set(key, value);
            ttls.set(key, ttl);
            return "OK";
        },
    };
}

function makeLogger() {
    const warnings = [];
    return { warnings, warn: (...args) => warnings.push(args.join(" ")) };
}

function makeService(options = {}) {
    return createGoogleDocumentAvailabilityService({
        apiKey: API_KEY,
        logger: makeLogger(),
        now:    () => NOW,
        ...options,
    });
}

async function checkOne(service, parsed, options) {
    const entries = await service.checkDocuments([parsed], options);
    return entries.get(`${parsed.kind}:${parsed.id}`);
}

describe("resolveTimeoutMs and resolveCacheTtlSeconds", () => {
    it("default to 8 seconds and 15 minutes, and bound configured values", () => {
        assert.equal(resolveTimeoutMs(undefined), 8000);
        assert.equal(resolveTimeoutMs("999"), 8000);
        assert.equal(resolveTimeoutMs("abc"), 8000);
        assert.equal(resolveTimeoutMs("2500"), 2500);

        assert.equal(resolveCacheTtlSeconds(undefined), 900);
        assert.equal(resolveCacheTtlSeconds("0"), 900);
        assert.equal(resolveCacheTtlSeconds("-5"), 900);
        assert.equal(resolveCacheTtlSeconds("1.5"), 900);
        assert.equal(resolveCacheTtlSeconds("300"), 300);
        assert.equal(resolveCacheTtlSeconds("999999"), 86400);
    });
});

describe("cacheKey", () => {
    it("names the kind and id, for the cache client's \"ethicapp\" prefix", () => {
        assert.equal(cacheKey(docLink), `google:document:drive_file:${FILE_ID}`);
        assert.equal(cacheKey(publishedSheet), `google:document:published:${PUBLISHED_ID}`);
        assert.equal(
            `ethicapp${cacheKey(docLink)}`,
            `ethicappgoogle:document:drive_file:${FILE_ID}`
        );
    });
});

describe("publishedDocumentName", () => {
    it("strips exactly one known product suffix", () => {
        assert.equal(publishedDocumentName("<title>Reading guide</title>"), "Reading guide");
        assert.equal(publishedDocumentName("<title>Grades - Google Drive</title>"), "Grades");
        assert.equal(publishedDocumentName("<title>Deck - Google Slides</title>"), "Deck");
        assert.equal(
            publishedDocumentName("<title>Diapositivas - Presentaciones de Google</title>"),
            "Diapositivas"
        );
        assert.equal(
            publishedDocumentName("<title>A - Google Drive - Google Drive</title>"),
            "A - Google Drive"
        );
        assert.equal(
            publishedDocumentName("<title>Notes - Google Docs</title>"),
            "Notes - Google Docs"
        );
    });

    it("decodes entities and collapses whitespace", () => {
        assert.equal(
            publishedDocumentName("<html><head><TITLE lang=\"es\">\n  Caso &amp; &#233;tica"
                + " &#x27;2026&#x27; &quot;A&quot; &lt;b&gt;\n</TITLE>"),
            "Caso & ética '2026' \"A\" <b>"
        );
        assert.equal(decodeHtmlEntities("&unknown; &#0; &#x110000;"), "&unknown; &#0; &#x110000;");
        assert.equal(publishedDocumentName("<p>No title</p>"), "");
    });
});

describe("createGoogleDocumentAvailabilityService: Drive files", () => {
    it("reports a link-shared file as available, sending the key as a header", async () => {
        const fetch = routedFetch({ api: () => json(200, driveFile()) });
        const service = makeService({ fetch });

        const entry = await checkOne(service, docLink);

        assert.deepEqual(entry, {
            status:       "available",
            product:      "document",
            name:         "Case reading",
            mimeType:     "application/vnd.google-apps.document",
            modifiedTime: MODIFIED_TIME,
        });
        assert.equal(fetch.calls.length, 1);
        const [{ url, options }] = fetch.calls;
        assert.equal(url, DRIVE_API_URL);
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "manual");
        assert.equal(options.headers["X-Goog-Api-Key"], API_KEY);
        assert.equal(options.headers["X-Goog-Drive-Resource-Keys"], undefined);
        assert.ok(options.signal instanceof AbortSignal);
    });

    it("refines a plain Drive link's product from the MIME type", async () => {
        const cases = [
            ["application/vnd.google-apps.document", "document"],
            ["application/vnd.google-apps.spreadsheet", "spreadsheets"],
            ["application/vnd.google-apps.presentation", "presentation"],
            ["application/pdf", "file"],
        ];
        for (const [mimeType, product] of cases) {
            const service = makeService({
                fetch: routedFetch({ api: () => json(200, driveFile({ mimeType })) }),
            });
            assert.equal((await checkOne(service, driveLink)).product, product, mimeType);
        }

        const docsService = makeService({
            fetch: routedFetch({
                api: () => json(200, driveFile({ mimeType: "application/pdf" })),
            }),
        });
        assert.equal((await checkOne(docsService, docLink)).product, "document",
            "a Docs link keeps its own product");
    });

    it("sends the resource key header when the link carries one", async () => {
        const fetch = routedFetch({ api: () => json(200, driveFile()) });
        const parsed = parseGoogleDocumentUrl(
            `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=0-AbC_dEf`
        );

        await checkOne(makeService({ fetch }), parsed);

        assert.equal(fetch.calls[0].options.headers["X-Goog-Drive-Resource-Keys"],
            `${FILE_ID}/0-AbC_dEf`);
        assert.equal(fetch.calls[0].url, DRIVE_API_URL);
    });

    it("probes the opening URL anonymously after a Drive API 404", async () => {
        const cases = [
            [new Response("", { status: 401 }), "not_public"],
            [redirect("https://accounts.google.com/ServiceLogin?continue=x"), "not_public"],
            [redirect("https://ACCOUNTS.google.com/v3/signin", 307), "not_public"],
            [new Response("", { status: 404 }), "not_found"],
            [new Response("", { status: 200 }), "unavailable"],
            [new Response("", { status: 500 }), "unavailable"],
            [redirect("https://docs.google.com/document/d/x/mobilebasic"), "unavailable"],
        ];
        for (const [probe, status] of cases) {
            const fetch = routedFetch({ api: () => driveError(404, "notFound"), probe });
            const entry = await checkOne(makeService({ fetch }), docLink);
            assert.deepEqual(entry, { status }, `${probe.status} ${probe.headers.get("location")}`);

            assert.equal(fetch.calls.length, 2);
            const { url, options } = fetch.calls[1];
            assert.equal(url, `https://docs.google.com/document/d/${FILE_ID}/preview`);
            assert.equal(options.redirect, "manual");
            assert.equal(options.credentials, "omit");
            assert.equal(options.headers["X-Goog-Api-Key"], undefined);
            assert.equal(options.headers.Cookie, undefined);
        }
    });

    it("probes Drive files at drive.google.com, with the resource key", async () => {
        const fetch = routedFetch({
            api:   () => driveError(404, "notFound"),
            probe: () => new Response("", { status: 401 }),
        });
        const parsed = parseGoogleDocumentUrl(
            `https://drive.google.com/open?id=${FILE_ID}&resourcekey=0-key`
        );

        assert.deepEqual(await checkOne(makeService({ fetch }), parsed), { status: "not_public" });
        assert.equal(fetch.calls[1].url,
            `https://drive.google.com/file/d/${FILE_ID}/preview?resourcekey=0-key`);
    });

    it("answers unavailable for 403, 429 and 5xx without probing", async () => {
        const answers = [
            driveError(403, "forbidden"),
            driveError(403, "dailyLimitExceeded"),
            driveError(429, "rateLimitExceeded"),
            driveError(500, "backendError"),
            new Response("Service Unavailable", { status: 503 }),
            redirect("https://example.com/elsewhere"),
            json(200, null),
        ];
        for (const answer of answers) {
            const fetch = routedFetch({ api: answer });
            const entry = await checkOne(makeService({ fetch }), docLink);
            assert.deepEqual(entry, { status: "unavailable" });
            assert.equal(fetch.calls.length, 1, `no probe after HTTP ${answer.status}`);
        }
    });

    it("logs an IP-restricted key's 403 once, without the key", async () => {
        const logger = makeLogger();
        const service = makeService({
            fetch: routedFetch({ api: () => driveError(403, "forbidden") }),
            logger,
        });

        await checkOne(service, docLink);
        await checkOne(service, driveLink);

        assert.equal(logger.warnings.length, 1);
        assert.match(logger.warnings[0], /HTTP 403 \(forbidden\)/u);
        assert.match(logger.warnings[0], /IP addresses/u);
        assert.ok(!logger.warnings[0].includes(API_KEY));
    });

    it("answers unavailable for network errors and timeouts", async () => {
        const network = makeService({
            fetch: makeFetch(() => {
                throw new TypeError("fetch failed");
            }),
        });
        assert.deepEqual(await checkOne(network, docLink), { status: "unavailable" });

        const logger = makeLogger();
        const hanging = makeFetch((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
        }));
        const slow = makeService({ fetch: hanging, timeoutMs: 1000, logger });
        const startedAt = Date.now();
        assert.deepEqual(await checkOne(slow, docLink), { status: "unavailable" });
        assert.ok(Date.now() - startedAt >= 900, "waited for the timeout");
        assert.match(logger.warnings[0], /timed out/u);
    });

    it("never puts the key in a URL or a log line", async () => {
        const logger = makeLogger();
        const answers = [
            json(200, driveFile()),
            driveError(404, "notFound"),
            driveError(403, "forbidden"),
            driveError(400, "badRequest"),
            new Response("", { status: 502 }),
        ];
        for (const api of answers) {
            const fetch = routedFetch({ api, probe: () => new Response("", { status: 503 }) });
            await checkOne(makeService({ fetch, logger }), docLink);
            for (const { url } of fetch.calls) {
                assert.ok(!url.includes(API_KEY), url);
                assert.ok(!url.includes("key="), url);
            }
        }
        await checkOne(makeService({
            fetch: makeFetch(() => {
                throw new TypeError("fetch failed");
            }),
            logger,
        }), docLink);
        assert.ok(logger.warnings.length > 0);
        for (const line of logger.warnings) {
            assert.ok(!line.includes(API_KEY), line);
        }
    });
});

describe("createGoogleDocumentAvailabilityService: published documents", () => {
    it("reads the name from the published page's title", async () => {
        const titles = [
            [publishedDoc, "<title>Reading guide</title>", "Reading guide"],
            [
                publishedSheet,
                "<title>Grades &amp; scores - Google Drive</title>",
                "Grades & scores",
            ],
            [
                parseGoogleDocumentUrl(`${SLIDES_BASE}/e/${PUBLISHED_ID}/pub`),
                "<title>Deck - Google Slides</title>",
                "Deck",
            ],
            [
                parseGoogleDocumentUrl(`${SLIDES_BASE}/e/${PUBLISHED_ID}/embed`),
                "<title>Dilema &#233;tico - Presentaciones de Google</title>",
                "Dilema ético",
            ],
        ];
        for (const [parsed, title, name] of titles) {
            const fetch = makeFetch(() => html(200, `<!doctype html><html><head>${title}</head>`));
            const entry = await checkOne(makeService({ fetch }), parsed);
            assert.deepEqual(entry, {
                status:       "available",
                product:      parsed.product,
                name,
                mimeType:     null,
                modifiedTime: null,
            });
        }
    });

    it("probes the canonical published URL anonymously, without the API", async () => {
        const fetch = makeFetch(() => html(200, "<title>Grades - Google Drive</title>"));

        await checkOne(makeService({ fetch }), publishedSheet);

        assert.equal(fetch.calls.length, 1);
        const [{ url, options }] = fetch.calls;
        assert.equal(url, `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pubhtml`);
        assert.equal(options.redirect, "manual");
        assert.equal(options.credentials, "omit");
        assert.equal(options.headers["X-Goog-Api-Key"], undefined);
        assert.equal(options.headers.Cookie, undefined);
    });

    it("maps refusals to not_found, not_public and unavailable", async () => {
        const cases = [
            [new Response("", { status: 404 }), "not_found"],
            [new Response("", { status: 401 }), "not_public"],
            [redirect("https://accounts.google.com/ServiceLogin"), "not_public"],
            [redirect("https://docs.google.com/spreadsheets/d/e/x/pubhtml?gid=0"), "unavailable"],
            [new Response("", { status: 403 }), "unavailable"],
            [new Response("", { status: 500 }), "unavailable"],
        ];
        for (const [answer, status] of cases) {
            const service = makeService({ fetch: makeFetch(() => answer) });
            const entry = await checkOne(service, publishedSheet);
            assert.deepEqual(entry, { status });
        }
    });

    it("reads at most 64 KiB of the page to find the title", async () => {
        let pulls = 0;
        const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
        const body = new ReadableStream({
            pull(controller) {
                pulls += 1;
                controller.enqueue(pulls > 100
                    ? new TextEncoder().encode("<title>Too late</title>")
                    : chunk);
                if (pulls > 100) {
                    controller.close();
                }
            },
        });
        const fetch = makeFetch(() => new Response(body, { status: 200 }));

        const entry = await checkOne(makeService({ fetch }), publishedDoc);

        assert.equal(entry.status, "available");
        assert.equal(entry.name, "");
        const bytesPulled = pulls * chunk.length;
        assert.ok(bytesPulled <= MAX_TITLE_SCAN_BYTES + 2 * chunk.length, `${pulls} pulls`);
    });
});

describe("createGoogleDocumentAvailabilityService: configuration", () => {
    it("answers not_configured for every document without a key", async () => {
        const fetch = makeFetch(() => {
            throw new Error("must not be called");
        });
        const cache = makeCache();
        for (const apiKey of ["", "   ", undefined, () => undefined]) {
            const service = makeService({ fetch, redis: cache, apiKey });
            assert.equal(service.isConfigured(), false);
            const entries = await service.checkDocuments([docLink, publishedSheet]);
            assert.deepEqual([...entries], [
                [`drive_file:${FILE_ID}`, { status: "not_configured" }],
                [`published:${PUBLISHED_ID}`, { status: "not_configured" }],
            ]);
        }
        assert.equal(fetch.calls.length, 0);
        assert.equal(cache.calls.mget.length + cache.calls.set.length, 0);
    });

    it("reads the key on every check", async () => {
        let key = "";
        const service = makeService({
            fetch:  routedFetch({ api: () => json(200, driveFile()) }),
            apiKey: () => key,
        });
        assert.equal(service.isConfigured(), false);
        key = API_KEY;
        assert.equal(service.isConfigured(), true);
        assert.equal((await checkOne(service, docLink)).status, "available");
    });
});

describe("createGoogleDocumentAvailabilityService: cache", () => {
    it("caches available documents for the configured TTL and serves hits", async () => {
        const fetch = routedFetch({ api: () => json(200, driveFile()) });
        const cache = makeCache();
        const service = makeService({ fetch, redis: cache, cacheTtlSeconds: () => "300" });

        const first = await checkOne(service, docLink);
        const key = `google:document:drive_file:${FILE_ID}`;
        assert.deepEqual(cache.calls.set.map(({ key: k, mode, ttl }) => [k, mode, ttl]),
            [[key, "EX", 300]]);
        assert.equal(JSON.parse(cache.store.get(key)).expiresAt, NOW + 300 * 1000);

        const second = await checkOne(service, docLink);
        assert.deepEqual(second, first);
        assert.equal(fetch.calls.length, 1, "served from the cache");

        const refined = await checkOne(service, driveLink);
        assert.equal(refined.product, "document", "a cached Drive link is refined too");
        assert.equal(fetch.calls.length, 1);
    });

    it("uses 900 seconds by default, caps the TTL at a day", async () => {
        for (const [cacheTtlSeconds, ttl] of [[undefined, 900], ["9999999", 86400]]) {
            const cache = makeCache();
            const service = makeService({
                fetch: routedFetch({ api: () => json(200, driveFile()) }),
                redis: cache,
                cacheTtlSeconds,
            });
            await checkOne(service, docLink);
            assert.equal(cache.calls.set[0].ttl, ttl);
        }
    });

    it("caches not_public and not_found for 120 seconds", async () => {
        for (const [probeStatus, status] of [[401, "not_public"], [404, "not_found"]]) {
            const fetch = routedFetch({
                api:   () => driveError(404, "notFound"),
                probe: () => new Response("", { status: probeStatus }),
            });
            const cache = makeCache();
            const service = makeService({ fetch, redis: cache });

            assert.deepEqual(await checkOne(service, docLink), { status });
            assert.equal(cache.calls.set[0].ttl, 120);
            assert.deepEqual(await checkOne(service, docLink), { status });
            assert.equal(fetch.calls.length, 2, "the second check is a cache hit");
        }
    });

    it("never caches unavailable or not_configured entries", async () => {
        const cache = makeCache();
        const fetch = routedFetch({ api: () => driveError(503, "backendError") });
        const service = makeService({ fetch, redis: cache });

        await checkOne(service, docLink);
        await checkOne(service, docLink);
        await checkOne(makeService({ fetch, redis: cache, apiKey: "" }), docLink);

        assert.equal(cache.calls.set.length, 0);
        assert.equal(fetch.calls.length, 2, "each unavailable check goes to Google");
    });

    it("skips reads but still refreshes the cache with useCache: false", async () => {
        const fetch = routedFetch({ api: () => json(200, driveFile({ name: "Fresh" })) });
        const cache = makeCache();
        const key = `google:document:drive_file:${FILE_ID}`;
        cache.store.set(key, JSON.stringify({
            status:       "available",
            product:      "document",
            name:         "Stale",
            mimeType:     "application/vnd.google-apps.document",
            modifiedTime: MODIFIED_TIME,
            expiresAt:    NOW + 60000,
        }));
        const service = makeService({ fetch, redis: cache });

        assert.equal((await checkOne(service, docLink)).name, "Stale");
        assert.equal((await checkOne(service, docLink, { useCache: false })).name, "Fresh");
        assert.equal(cache.calls.mget.length, 1);
        assert.equal(JSON.parse(cache.store.get(key)).name, "Fresh");
        assert.equal((await checkOne(service, docLink)).name, "Fresh");
    });

    it("ignores expired, malformed and other-product entries", async () => {
        const cache = makeCache();
        cache.store.set(`google:document:drive_file:${FILE_ID}`, JSON.stringify({
            status: "not_found", product: "document", expiresAt: NOW - 1,
        }));
        cache.store.set(`google:document:drive_file:${OTHER_FILE_ID}`, "{not json");
        cache.store.set(`google:document:published:${PUBLISHED_ID}`, JSON.stringify({
            status: "not_found", product: "document", expiresAt: NOW + 60000,
        }));
        const fetch = makeFetch((url) => (url.startsWith("https://www.googleapis.com/")
            ? json(200, driveFile())
            : html(200, "<title>Grades - Google Drive</title>")));
        const service = makeService({ fetch, redis: cache });
        const other = parseGoogleDocumentUrl(
            `https://docs.google.com/document/d/${OTHER_FILE_ID}/edit`
        );

        const entries = await service.checkDocuments([docLink, other, publishedSheet]);

        assert.deepEqual([...entries.values()].map((entry) => entry.status),
            ["available", "available", "available"]);
        assert.equal(fetch.calls.length, 3);
        assert.equal((await checkOne(service, publishedDoc)).status, "available",
            "the published entry now holds spreadsheets, so a document link misses");
    });

    it("falls back to live checks when Redis fails or hangs", async () => {
        for (const cache of [
            makeCache({ failReads: true, failWrites: true }),
            makeCache({ hang: true }),
        ]) {
            const logger = makeLogger();
            const fetch = routedFetch({ api: () => json(200, driveFile()) });
            const service = makeService({ fetch, redis: cache, logger, cacheTimeoutMs: 20 });

            assert.equal((await checkOne(service, docLink)).status, "available");
            assert.equal(fetch.calls.length, 1);
            assert.ok(logger.warnings.some((line) => /Cache read failed/u.test(line)));
        }
    });
});

describe("createGoogleDocumentAvailabilityService: concurrency and input", () => {
    it("shares one request among concurrent checks of the same document", async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const fetch = routedFetch({
            api: async () => {
                await gate;
                return json(200, driveFile());
            },
        });
        const service = makeService({ fetch, redis: makeCache() });

        const checks = [
            service.checkDocuments([docLink]),
            service.checkDocuments([docLink], { useCache: false }),
            service.checkDocuments([docLink, docLink]),
        ];
        await new Promise((resolve) => setImmediate(resolve));
        release();
        const results = await Promise.all(checks);

        assert.equal(fetch.calls.length, 1);
        for (const entries of results) {
            assert.equal(entries.get(`drive_file:${FILE_ID}`).status, "available");
        }

        await service.checkDocuments([docLink], { useCache: false });
        assert.equal(fetch.calls.length, 2, "a later live check makes a new request");
    });

    it("answers each unique document once, in order, and not_found for invalid parts", async () => {
        const fetch = routedFetch({ api: () => json(200, driveFile()) });
        const service = makeService({ fetch });
        const invalid = { kind: "drive_file", product: "document", id: "short", resourceKey: null };

        const entries = await service.checkDocuments([docLink, null, driveLink, invalid, "x"]);

        assert.deepEqual([...entries.keys()], [`drive_file:${FILE_ID}`, "drive_file:short"]);
        assert.deepEqual(entries.get("drive_file:short"), { status: "not_found" });
        assert.equal(fetch.calls.length, 1);
        assert.equal((await service.checkDocuments(undefined)).size, 0);
    });
});
