// The adapter catalog (#812): `manifest.json` lists the adapters EthicApp
// ships. It is code, not deployment configuration, so it has no `enabled` and
// no per-environment variants. Whether an adapter may be used is decided at
// dispatch by the AI service policy gate (`effectiveServiceIds()` in the
// registry, #815).

// The AI Additions services an adapter may require, by their AI Additions id
// (the id their capability descriptor and the AI Additions catalog use). This
// is the one list of them in EthicApp.
export const AI_ADDITIONS_SERVICE_IDS = Object.freeze([
    "polyadic-agent",
    "argumentation-tutor",
    "case-analyst",
]);

// Keys the catalog no longer accepts, with the reason given to whoever adds one.
const REMOVED_KEYS = Object.freeze({
    enabled: "is removed (#812): adapters are listed, not enabled; usability is decided at dispatch",
});

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates one catalog entry and returns the problems found, or [] when it
 * is valid.
 *
 * - `requires` is mandatory: the AI Additions services the adapter talks to,
 *   each one of AI_ADDITIONS_SERVICE_IDS, without duplicates.
 * - A production adapter (no `development`) requires at least one service, so
 *   the service policy can always decide whether it may be used.
 * - A development adapter (`development: true`) talks to no AI Additions
 *   service and must declare `requires: []`. It is registered only when
 *   EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true.
 * - A `descriptor` names the capability descriptor of the one service the
 *   adapter requires, so it needs exactly one entry in `requires` and declares
 *   only its `path`: `requires[0]` replaces the former `descriptor.serviceId`.
 *
 * @param {Object} entry - One element of `manifest.services`.
 * @returns {string[]} Problems, in English, without the entry id.
 */
export function validateCatalogEntry(entry) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return ["must be an object"];
    }

    const problems = [];

    if (!isNonEmptyString(entry.id)) {
        problems.push("`id` must be a non-empty string");
    }
    if (!isNonEmptyString(entry.adapter)) {
        problems.push("`adapter` must be a non-empty string");
    }

    for (const [key, reason] of Object.entries(REMOVED_KEYS)) {
        if (Object.hasOwn(entry, key)) {
            problems.push(`\`${key}\` ${reason}`);
        }
    }

    if (entry.development !== undefined && typeof entry.development !== "boolean") {
        problems.push("`development` must be a boolean when present");
    }
    const isDevelopment = entry.development === true;

    if (!Array.isArray(entry.requires)) {
        problems.push("`requires` is missing: list the AI Additions services the adapter requires");
        return problems;
    }

    const unknown = entry.requires.filter(id => !AI_ADDITIONS_SERVICE_IDS.includes(id));
    if (unknown.length > 0) {
        problems.push(
            `\`requires\` names unknown AI Additions services (${unknown.map(String).join(", ")}): `
            + `expected ${AI_ADDITIONS_SERVICE_IDS.join(", ")}`
        );
    }
    if (new Set(entry.requires).size !== entry.requires.length) {
        problems.push("`requires` lists a service more than once");
    }

    if (isDevelopment && entry.requires.length > 0) {
        problems.push("a development adapter must declare `requires: []`");
    }
    if (!isDevelopment && entry.requires.length === 0) {
        problems.push("`requires` is empty: only development adapters require no AI Additions service");
    }

    if (entry.descriptor !== undefined && entry.descriptor !== null) {
        if (entry.requires.length !== 1) {
            problems.push("a `descriptor` needs exactly one service in `requires`");
        }
        if (Object.hasOwn(entry.descriptor, "serviceId")) {
            problems.push("`descriptor.serviceId` is replaced by `requires`");
        }
    }

    return problems;
}

/**
 * Validates the whole catalog: every entry, and that ids are unique.
 *
 * @param {Object} catalog - The parsed `manifest.json`.
 * @returns {string[]} Problems, each prefixed with the entry it concerns.
 */
export function validateCatalog(catalog) {
    if (!Array.isArray(catalog?.services)) {
        return ["`services` must be an array"];
    }

    const problems = [];
    const seenIds = new Set();

    catalog.services.forEach((entry, index) => {
        const label = isNonEmptyString(entry?.id) ? entry.id : `services[${index}]`;

        for (const problem of validateCatalogEntry(entry)) {
            problems.push(`${label}: ${problem}`);
        }

        if (isNonEmptyString(entry?.id)) {
            if (seenIds.has(entry.id)) {
                problems.push(`${label}: duplicate id`);
            }
            seenIds.add(entry.id);
        }
    });

    return problems;
}

/**
 * Throws when an entry is invalid. The catalog is shipped code, so an invalid
 * entry is a bug that must stop startup (and the image build, which runs the
 * catalog tests), not something to skip with a warning.
 *
 * @param {string[]} problems - Output of validateCatalog() or validateCatalogEntry().
 * @param {string} source - What was validated, for the message.
 */
export function assertValidCatalog(problems, source) {
    if (problems.length > 0) {
        throw new Error(
            `[external-services] Invalid adapter catalog ${source}:\n- ${problems.join("\n- ")}`
        );
    }
}

/**
 * Whether development adapters are registered:
 * EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true, which only the development
 * Compose file sets. Anything else, including unset, means false.
 *
 * @param {Object} [env=process.env]
 * @returns {boolean}
 */
export function developmentAdaptersEnabled(env = process.env) {
    return String(env.EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS ?? "").trim().toLowerCase() === "true";
}
