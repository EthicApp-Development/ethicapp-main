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

// The design elements a design analysis is about (epic #861, #863): its
// `produces` and `consumes` declarations name one. `question` is a semantic
// differential question, identified by position (helpers/design-analysis-units.js).
export const DESIGN_ANALYSIS_UNITS = Object.freeze(["question"]);

// The document schema of a design analysis, as stored in
// `design_analyses.document_schema`: a kebab-case name and a major version.
const DOCUMENT_SCHEMA_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/v[1-9][0-9]*$/u;

const DESIGN_ANALYSIS_DECLARATION_KEYS = Object.freeze(["documentSchema", "unit"]);

// Keys the catalog no longer accepts, with the reason given to whoever adds one.
const REMOVED_KEYS = Object.freeze({
    enabled: "is removed (#812): adapters are listed, not enabled; usability is decided at dispatch",
});

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates a `produces` or `consumes` declaration: a list of
 * `{ documentSchema, unit }`, each naming a design analysis schema
 * (`<name>/v<major>`) and one of DESIGN_ANALYSIS_UNITS, without other keys
 * and without repeating a pair. Absent is valid; it means none.
 *
 * @param {unknown} declaration
 * @param {string} key - `produces` or `consumes`, for the messages.
 * @returns {string[]} Problems, in English.
 */
function validateDesignAnalysisDeclaration(declaration, key) {
    if (declaration === undefined) {
        return [];
    }
    if (!Array.isArray(declaration)) {
        return [`\`${key}\` must be a list of { documentSchema, unit }`];
    }

    const problems = [];
    const seen = new Set();
    declaration.forEach((item, index) => {
        const label = `\`${key}[${index}]\``;
        if (!isPlainObject(item)) {
            problems.push(`${label} must be an object { documentSchema, unit }`);
            return;
        }

        const unknownKeys = Object.keys(item)
            .filter(name => !DESIGN_ANALYSIS_DECLARATION_KEYS.includes(name));
        if (unknownKeys.length > 0) {
            problems.push(`${label} has unknown keys (${unknownKeys.join(", ")})`);
        }

        const schemaValid = typeof item.documentSchema === "string"
            && DOCUMENT_SCHEMA_PATTERN.test(item.documentSchema);
        if (!schemaValid) {
            problems.push(
                `${label}.documentSchema must be a schema name with its major version, `
                + "such as claim-typology/v1"
            );
        }
        const unitValid = DESIGN_ANALYSIS_UNITS.includes(item.unit);
        if (!unitValid) {
            problems.push(`${label}.unit must be one of ${DESIGN_ANALYSIS_UNITS.join(", ")}`);
        }

        if (schemaValid && unitValid) {
            const pair = `${item.documentSchema} ${item.unit}`;
            if (seen.has(pair)) {
                problems.push(
                    `\`${key}\` lists ${item.documentSchema} per ${item.unit} more than once`
                );
            }
            seen.add(pair);
        }
    });

    return problems;
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
 * - `produces` and `consumes` (#863), when present, list the design analyses
 *   the adapter produces or needs, as `{ documentSchema, unit }`. A producer
 *   has the `design` scope. Whether a consumption has a producer is a
 *   catalog-wide question, answered by catalogWarnings().
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

    problems.push(...validateDesignAnalysisDeclaration(entry.produces, "produces"));
    problems.push(...validateDesignAnalysisDeclaration(entry.consumes, "consumes"));
    // What an adapter produces is stored as its design analysis.
    const declaresProduction = Array.isArray(entry.produces) && entry.produces.length > 0;
    const hasDesignScope = Array.isArray(entry.scopes) && entry.scopes.includes("design");
    if (declaresProduction && !hasDesignScope) {
        problems.push("an adapter that `produces` design analyses needs the `design` scope");
    }

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
 * What a valid catalog may still get wrong without being broken (#863): a
 * consumption of a design analysis that no entry of the catalog produces for
 * the same unit. The consumer then never receives that analysis, which may be
 * intended while its producer is not shipped yet, so it is a warning.
 *
 * @param {Object} catalog - A parsed `manifest.json` that passes validateCatalog().
 * @returns {string[]} Warnings, each prefixed with the entry it concerns.
 */
export function catalogWarnings(catalog) {
    const services = Array.isArray(catalog?.services) ? catalog.services : [];
    const produced = new Set(services.flatMap(entry => (Array.isArray(entry?.produces)
        ? entry.produces.map(item => `${item?.documentSchema} ${item?.unit}`)
        : [])));

    return services.flatMap(entry => (Array.isArray(entry?.consumes) ? entry.consumes : [])
        .filter(item => !produced.has(`${item?.documentSchema} ${item?.unit}`))
        .map(item => `${entry.id}: consumes ${item?.documentSchema} per ${item?.unit}, `
            + "which no adapter in the catalog produces"));
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
