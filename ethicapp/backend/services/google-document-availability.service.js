// Google document availability (#791, epic #789): whether a Google Docs,
// Sheets, Slides or Drive document attached to a case opens for anyone, as
// spike #790 established:
// - a Drive file is looked up with the Drive API v3 `files.get` and the
//   GOOGLE_API_KEY; a 404 there is followed by an anonymous probe of the
//   document's opening URL, which tells restricted (401, or a redirect to the
//   sign-in page) from missing (404);
// - a document published to the web has no Drive file id, so only the
//   anonymous probe checks it, and its name comes from the page's <title>.
//
// Results are cached in the cache Redis (REDIS_CACHE_*), always with a TTL.
// Checks never throw for Google or Redis failures: each document resolves to
// an entry whose `status` is available, not_public, not_found, unavailable or
// not_configured. The API key travels in the X-Goog-Api-Key header only: it is
// never put in a URL, a log line or an error message.

import {
    GOOGLE_DOCUMENT_PRODUCTS,
    canonicalGoogleDocumentUrl,
    googleDocumentKey,
    productFromMimeType,
} from "../../common/modules/google-document-urls.js";

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files/";
const DRIVE_FILE_QUERY = "fields=id,name,mimeType,modifiedTime&supportsAllDrives=true";
const SIGN_IN_HOST = "accounts.google.com";
const CACHE_KEY_PREFIX = "google:document:";

export const DEFAULT_TIMEOUT_MS = 8000;
const MINIMUM_TIMEOUT_MS = 1000;
export const DEFAULT_CACHE_TTL_SECONDS = 900;
export const MAX_CACHE_TTL_SECONDS = 86400;
export const NEGATIVE_CACHE_TTL_SECONDS = 120;
const DEFAULT_CACHE_TIMEOUT_MS = 1000;
// How much of a published page is read to find its <title>.
export const MAX_TITLE_SCAN_BYTES = 64 * 1024;
// The same warning is logged at most once in this interval.
const WARNING_INTERVAL_MS = 5 * 60 * 1000;

export const DOCUMENT_STATUS = Object.freeze({
    AVAILABLE:      "available",
    NOT_PUBLIC:     "not_public",
    NOT_FOUND:      "not_found",
    UNAVAILABLE:    "unavailable",
    NOT_CONFIGURED: "not_configured",
});

// Product suffixes Google appends to a published page's title, which depend
// on the owner's language (#790). Docs add none.
const PUBLISHED_TITLE_SUFFIXES = Object.freeze([
    " - Google Drive",
    " - Google Slides",
    " - Presentaciones de Google",
]);

const NAMED_ENTITIES = Object.freeze({
    amp:  "&",
    lt:   "<",
    gt:   ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
});

const NOT_PUBLIC_ENTRY = Object.freeze({ status: DOCUMENT_STATUS.NOT_PUBLIC });
const NOT_FOUND_ENTRY = Object.freeze({ status: DOCUMENT_STATUS.NOT_FOUND });
const UNAVAILABLE_ENTRY = Object.freeze({ status: DOCUMENT_STATUS.UNAVAILABLE });
const NOT_CONFIGURED_ENTRY = Object.freeze({ status: DOCUMENT_STATUS.NOT_CONFIGURED });

/**
 * The per-request timeout: GOOGLE_DOCUMENT_TIMEOUT_MS when it is an integer of
 * at least 1000, the 8-second default otherwise.
 */
export function resolveTimeoutMs(value) {
    const configured = Number(value);
    return Number.isInteger(configured) && configured >= MINIMUM_TIMEOUT_MS
        ? configured
        : DEFAULT_TIMEOUT_MS;
}

/**
 * The TTL of available documents: GOOGLE_DOCUMENT_CACHE_TTL_SECONDS when it is
 * a positive integer, capped at one day; the 15-minute default otherwise.
 */
export function resolveCacheTtlSeconds(value) {
    const configured = Number(value);
    if (!Number.isInteger(configured) || configured < 1) {
        return DEFAULT_CACHE_TTL_SECONDS;
    }
    return Math.min(configured, MAX_CACHE_TTL_SECONDS);
}

/**
 * The cache key of a parsed document, without the cache client's "ethicapp"
 * key prefix: the stored key is `ethicappgoogle:document:<kind>:<id>`.
 */
export function cacheKey(parsed) {
    return `${CACHE_KEY_PREFIX}${googleDocumentKey(parsed)}`;
}

/** Decodes the character references Google writes in page titles. */
export function decodeHtmlEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity) => {
        if (entity[0] !== "#") {
            return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
        }
        const codePoint = entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    });
}

/**
 * The document name in a published page's HTML: the <title>, decoded and with
 * its whitespace collapsed, minus one known product suffix. "" without a title.
 */
export function publishedDocumentName(html) {
    const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
    if (!match) {
        return "";
    }
    const title = decodeHtmlEntities(match[1]).replace(/\s+/gu, " ").trim();
    const suffix = PUBLISHED_TITLE_SUFFIXES.find((candidate) => title.endsWith(candidate));
    return suffix ? title.slice(0, -suffix.length).trim() : title;
}

// The start of a response body, up to `maxBytes` or the end of its <title>.
async function readHead(response, maxBytes) {
    if (!response.body) {
        return "";
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
        while (bytes < maxBytes) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            const chunk = value.subarray(0, maxBytes - bytes);
            bytes += chunk.length;
            text += decoder.decode(chunk, { stream: true });
            if (/<\/title>/iu.test(text)) {
                break;
            }
        }
    } finally {
        reader.cancel().catch(() => {});
    }
    return text + decoder.decode();
}

// Releases a response body that is not read.
function discardBody(response) {
    try {
        response.body?.cancel().catch(() => {});
    } catch {
        // Already consumed or locked: nothing to release.
    }
}

async function readJson(response) {
    try {
        return JSON.parse(await response.text());
    } catch {
        return null;
    }
}

function errorReason(body) {
    const errors = body?.error?.errors;
    const reason = Array.isArray(errors) ? errors.find((item) => item?.reason)?.reason : null;
    return typeof reason === "string" ? reason : null;
}

function isSignInRedirect(response) {
    if (response.status < 300 || response.status > 399) {
        return false;
    }
    try {
        const location = new URL(response.headers.get("location") ?? "", "https://docs.google.com");
        return location.hostname.toLowerCase() === SIGN_IN_HOST;
    } catch {
        return false;
    }
}

// What an anonymous response says about a document that does not open:
// not_public, not_found, or null when it says neither.
function anonymousRefusal(response) {
    if (response.status === 401 || isSignInRedirect(response)) {
        return NOT_PUBLIC_ENTRY;
    }
    if (response.status === 404) {
        return NOT_FOUND_ENTRY;
    }
    return null;
}

function stringOrNull(value) {
    return typeof value === "string" ? value : null;
}

// A Drive file's product: the link's own, unless the link is a plain Drive
// file link, which the MIME type may refine to Docs, Sheets or Slides.
function driveFileProduct(parsed, mimeType) {
    return parsed.product === "file" ? productFromMimeType(mimeType) : parsed.product;
}

function isValidDocument(parsed) {
    try {
        canonicalGoogleDocumentUrl(parsed);
        return true;
    } catch {
        return false;
    }
}

// Resolves to the operation's result, or rejects after `timeoutMs`: a Redis
// client that queues commands while reconnecting must not stall a check.
function withTimeout(operation, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Cache operation timed out.")), timeoutMs);
        timeoutId.unref?.();
    });
    return Promise.race([Promise.resolve().then(operation), timeout])
        .finally(() => clearTimeout(timeoutId));
}

function valueOf(option) {
    return typeof option === "function" ? option() : option;
}

/**
 * Builds an availability service.
 * - `fetch`: a WHATWG fetch implementation.
 * - `redis`: an ioredis-like cache client with `mget(...keys)` and
 *   `set(key, value, "EX", seconds)`, or null for no cache.
 * - `apiKey`, `timeoutMs`, `cacheTtlSeconds`: values, or functions returning
 *   them, read on every check (GOOGLE_API_KEY, GOOGLE_DOCUMENT_TIMEOUT_MS and
 *   GOOGLE_DOCUMENT_CACHE_TTL_SECONDS for the default instance).
 * - `now`: clock in milliseconds, used to drop entries past their TTL even if
 *   the cache kept them, and to space out repeated warnings.
 */
export function createGoogleDocumentAvailabilityService({
    fetch: fetchImpl = globalThis.fetch,
    redis = null,
    apiKey = "",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
    logger = console,
    now = () => Date.now(),
    cacheTimeoutMs = DEFAULT_CACHE_TIMEOUT_MS,
} = {}) {
    const inFlight = new Map();
    const lastWarnedAt = new Map();

    function warn(message) {
        const currentTime = now();
        const last = lastWarnedAt.get(message);
        if (last !== undefined && currentTime - last < WARNING_INTERVAL_MS) {
            return;
        }
        lastWarnedAt.set(message, currentTime);
        logger.warn(`[google-documents] ${message}`);
    }

    function currentApiKey() {
        const key = valueOf(apiKey);
        return typeof key === "string" ? key.trim() : "";
    }

    function isConfigured() {
        return currentApiKey().length > 0;
    }

    // Runs `request(signal)` with the timeout. Timeouts and network errors
    // resolve to unavailable; `label` names the request in the warning.
    async function timedRequest(label, request) {
        const controller = new AbortController();
        const requestTimeoutMs = resolveTimeoutMs(valueOf(timeoutMs));
        const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
        timeoutId.unref?.();
        try {
            return await request(controller.signal);
        } catch (error) {
            const timedOut = controller.signal.aborted || error?.name === "AbortError";
            warn(timedOut ? `${label} timed out.` : `${label} could not be reached.`);
            return UNAVAILABLE_ENTRY;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // GET without cookies or redirects, as a signed-out reader would.
    function anonymousGet(url, signal) {
        return fetchImpl(url, {
            method:      "GET",
            headers:     { Accept: "text/html" },
            redirect:    "manual",
            credentials: "omit",
            signal,
        });
    }

    // A Drive file the API does not show: a 401 or a sign-in redirect means
    // it is restricted, a 404 that it does not exist.
    function probeDriveFile(parsed) {
        return timedRequest("Anonymous document probe", async (signal) => {
            const response = await anonymousGet(canonicalGoogleDocumentUrl(parsed), signal);
            discardBody(response);
            const refusal = anonymousRefusal(response);
            if (!refusal) {
                warn(`Anonymous document probe answered HTTP ${response.status}.`);
            }
            return refusal ?? UNAVAILABLE_ENTRY;
        });
    }

    async function checkDriveFile(parsed, key) {
        const headers = { Accept: "application/json", "X-Goog-Api-Key": key };
        if (parsed.resourceKey) {
            headers["X-Goog-Drive-Resource-Keys"] = `${parsed.id}/${parsed.resourceKey}`;
        }
        const outcome = await timedRequest("Drive API request", async (signal) => {
            // No redirects: the key header must not follow one to another host.
            const response = await fetchImpl(
                `${DRIVE_FILES_ENDPOINT}${encodeURIComponent(parsed.id)}?${DRIVE_FILE_QUERY}`,
                { method: "GET", headers, redirect: "manual", signal }
            );
            if (response.status === 404) {
                discardBody(response);
                return { probe: true };
            }
            const body = await readJson(response);
            if (!response.ok) {
                const reason = errorReason(body);
                const detail = reason ? ` (${reason})` : "";
                const hint = response.status === 403
                    ? " Check that the key allows the Drive API and this server's IP addresses."
                    : "";
                warn(`Drive API answered HTTP ${response.status}${detail}.${hint}`);
                return UNAVAILABLE_ENTRY;
            }
            if (!body || typeof body !== "object") {
                warn("Drive API returned an unexpected response.");
                return UNAVAILABLE_ENTRY;
            }
            const mimeType = stringOrNull(body.mimeType);
            return {
                status:       DOCUMENT_STATUS.AVAILABLE,
                product:      driveFileProduct(parsed, mimeType),
                name:         typeof body.name === "string" ? body.name : "",
                mimeType,
                modifiedTime: stringOrNull(body.modifiedTime),
            };
        });
        return outcome.probe ? probeDriveFile(parsed) : outcome;
    }

    function checkPublished(parsed) {
        return timedRequest("Published document probe", async (signal) => {
            const response = await anonymousGet(canonicalGoogleDocumentUrl(parsed), signal);
            if (response.status === 200) {
                const html = await readHead(response, MAX_TITLE_SCAN_BYTES);
                return {
                    status:       DOCUMENT_STATUS.AVAILABLE,
                    product:      parsed.product,
                    name:         publishedDocumentName(html),
                    mimeType:     null,
                    modifiedTime: null,
                };
            }
            discardBody(response);
            const refusal = anonymousRefusal(response);
            if (!refusal) {
                warn(`Published document probe answered HTTP ${response.status}.`);
            }
            return refusal ?? UNAVAILABLE_ENTRY;
        });
    }

    // Cached entries carry the product they were checked as: a published id
    // only opens under its own product, so another product is a cache miss.
    function decodeCached(raw, parsed) {
        if (typeof raw !== "string") {
            return null;
        }
        let stored;
        try {
            stored = JSON.parse(raw);
        } catch {
            return null;
        }
        if (!stored || !(Number(stored.expiresAt) > now())) {
            return null;
        }
        if (parsed.kind === "published" && stored.product !== parsed.product) {
            return null;
        }
        if (stored.status === DOCUMENT_STATUS.NOT_PUBLIC) {
            return NOT_PUBLIC_ENTRY;
        }
        if (stored.status === DOCUMENT_STATUS.NOT_FOUND) {
            return NOT_FOUND_ENTRY;
        }
        if (stored.status !== DOCUMENT_STATUS.AVAILABLE || typeof stored.name !== "string"
            || !GOOGLE_DOCUMENT_PRODUCTS.includes(stored.product)) {
            return null;
        }
        const mimeType = stringOrNull(stored.mimeType);
        const product = parsed.kind === "published"
            ? parsed.product
            : driveFileProduct(parsed, mimeType);
        return {
            status:       DOCUMENT_STATUS.AVAILABLE,
            product,
            name:         stored.name,
            mimeType,
            modifiedTime: stringOrNull(stored.modifiedTime),
        };
    }

    async function readCache(documents) {
        const entries = new Map();
        if (!redis || documents.length === 0) {
            return entries;
        }
        try {
            const values = await withTimeout(
                () => redis.mget(...documents.map(cacheKey)),
                cacheTimeoutMs
            );
            documents.forEach((parsed, index) => {
                const entry = decodeCached(values?.[index], parsed);
                if (entry) {
                    entries.set(googleDocumentKey(parsed), entry);
                }
            });
        } catch (error) {
            warn(`Cache read failed: ${error?.message}`);
        }
        return entries;
    }

    function ttlFor(entry) {
        if (entry.status === DOCUMENT_STATUS.AVAILABLE) {
            return resolveCacheTtlSeconds(valueOf(cacheTtlSeconds));
        }
        if (entry.status === DOCUMENT_STATUS.NOT_PUBLIC
            || entry.status === DOCUMENT_STATUS.NOT_FOUND) {
            return NEGATIVE_CACHE_TTL_SECONDS;
        }
        return null;
    }

    async function writeCache(parsed, entry) {
        const ttl = ttlFor(entry);
        if (!redis || ttl === null) {
            return;
        }
        const product = entry.product ?? parsed.product;
        const stored = JSON.stringify({ ...entry, product, expiresAt: now() + ttl * 1000 });
        try {
            await withTimeout(() => redis.set(cacheKey(parsed), stored, "EX", ttl), cacheTimeoutMs);
        } catch (error) {
            warn(`Cache write failed: ${error?.message}`);
        }
    }

    // One live check per document at a time: concurrent checks of the same
    // document share the request. Its result refreshes the cache.
    function liveCheck(parsed, key) {
        const flightKey = [parsed.kind, parsed.id, parsed.product, parsed.resourceKey ?? ""]
            .join(":");
        const existing = inFlight.get(flightKey);
        if (existing) {
            return existing;
        }
        const pending = (async () => {
            let entry;
            try {
                entry = parsed.kind === "published"
                    ? await checkPublished(parsed)
                    : await checkDriveFile(parsed, key);
            } catch (error) {
                warn(`Document check failed: ${error?.message}`);
                entry = UNAVAILABLE_ENTRY;
            }
            await writeCache(parsed, entry);
            return entry;
        })();
        inFlight.set(flightKey, pending);
        pending.finally(() => {
            if (inFlight.get(flightKey) === pending) {
                inFlight.delete(flightKey);
            }
        });
        return pending;
    }

    /**
     * Checks parsed documents (results of parseGoogleDocumentUrl). Resolves to
     * a Map keyed by googleDocumentKey, in the order of the unique documents
     * given, whose entries are:
     * - `{ status: "available", product, name, mimeType, modifiedTime }`;
     * - `{ status: "not_public" }`, `{ status: "not_found" }`;
     * - `{ status: "unavailable" }` when Google could not tell;
     * - `{ status: "not_configured" }` for every document without an API key.
     * With `useCache: false` the cache is not read, but is still refreshed.
     */
    async function checkDocuments(parsedList, { useCache = true } = {}) {
        const order = [];
        const documents = new Map();
        const entries = new Map();
        for (const parsed of Array.isArray(parsedList) ? parsedList : []) {
            if (!parsed || typeof parsed !== "object") {
                continue;
            }
            const documentKey = googleDocumentKey(parsed);
            if (order.includes(documentKey)) {
                continue;
            }
            order.push(documentKey);
            if (isValidDocument(parsed)) {
                documents.set(documentKey, parsed);
            } else {
                entries.set(documentKey, NOT_FOUND_ENTRY);
            }
        }

        const key = currentApiKey();
        if (!key) {
            for (const documentKey of documents.keys()) {
                entries.set(documentKey, NOT_CONFIGURED_ENTRY);
            }
        } else if (documents.size > 0) {
            const cached = useCache ? await readCache([...documents.values()]) : new Map();
            const checked = await Promise.all([...documents].map(([documentKey, parsed]) => (
                cached.get(documentKey) ?? liveCheck(parsed, key)
            )));
            [...documents.keys()].forEach((documentKey, index) => {
                entries.set(documentKey, checked[index] ?? UNAVAILABLE_ENTRY);
            });
        }
        return new Map(order.map((documentKey) => [documentKey, entries.get(documentKey)]));
    }

    return { isConfigured, checkDocuments };
}

// The cache Redis client opens its connection when imported, so the default
// instance imports it on first use: modules and tests that only need the
// factory never connect to Redis.
function lazyCacheRedis() {
    let clientPromise = null;
    const redis = () => {
        clientPromise ??= import("../db/redis.js").then((module) => module.default);
        return clientPromise;
    };
    return {
        mget: async (...keys) => (await redis()).mget(...keys),
        set:  async (...args) => (await redis()).set(...args),
    };
}

export const googleDocumentAvailability = createGoogleDocumentAvailabilityService({
    fetch:           (...args) => globalThis.fetch(...args),
    redis:           lazyCacheRedis(),
    apiKey:          () => process.env.GOOGLE_API_KEY,
    timeoutMs:       () => process.env.GOOGLE_DOCUMENT_TIMEOUT_MS,
    cacheTtlSeconds: () => process.env.GOOGLE_DOCUMENT_CACHE_TTL_SECONDS,
});

export default googleDocumentAvailability;
