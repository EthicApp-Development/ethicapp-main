// Server-side validation of per-phase external service configurations (#731).
//
// A design phase stores `externalServices.configurations[serviceId]`, a map of
// capability descriptor field keys to scalar values (#729). When a design is
// saved, every configuration of an enabled service is checked against that
// service's normalized descriptor (#727): type, enum membership, numeric
// limits and step, text length and pattern, required fields and unknown keys.
//
// Lifecycle never blocks a save:
// - deprecated fields and enum values are accepted with a warning;
// - a problem the stored design already had (same service, field, code and
//   value) is accepted with a `no_longer_accepted` warning: the teacher did not
//   introduce it, and the service warns or substitutes at instantiation;
// - when the descriptor cannot be fetched, the configuration is stored as is,
//   with a `not_validated` warning.
//
// Only new problems are errors. The editor maps both lists to field messages;
// see external-services/README.md, "Configuration validation".

export const INVALID_CONFIGURATION_CODE = "INVALID_SERVICE_CONFIGURATION";

// Validation does not depend on display text, so descriptors are read in one
// fixed locale and share one cache entry per service.
const VALIDATION_LOCALE = "en_US";

const STEP_TOLERANCE = 1e-9;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnset(value) {
    return value === undefined || value === null;
}

function typeProblem(field, value) {
    switch (field.type) {
    case "integer":
        return Number.isInteger(value) ? null : "invalid_type";
    case "number":
        return typeof value === "number" && Number.isFinite(value) ? null : "invalid_type";
    case "boolean":
        return typeof value === "boolean" ? null : "invalid_type";
    case "text":
        return typeof value === "string" ? null : "invalid_type";
    case "enum":
        return ["string", "number", "boolean"].includes(typeof value) ? null : "invalid_type";
    default:
        return "invalid_type";
    }
}

function numericProblem(validation, value) {
    const { minimum, maximum, step } = validation;
    if (typeof minimum === "number" && value < minimum) {
        return "below_minimum";
    }
    if (typeof maximum === "number" && value > maximum) {
        return "above_maximum";
    }
    if (typeof step === "number" && step > 0) {
        const steps = (value - (typeof minimum === "number" ? minimum : 0)) / step;
        if (Math.abs(steps - Math.round(steps)) > STEP_TOLERANCE) {
            return "step_mismatch";
        }
    }
    return null;
}

function compilePattern(pattern) {
    try {
        return new RegExp(pattern, "u");
    } catch {
        return null; // a pattern this runtime cannot compile is not enforced
    }
}

function textProblem(validation, value) {
    const { maxLength, pattern } = validation;
    if (Number.isInteger(maxLength) && [...value].length > maxLength) {
        return "too_long";
    }
    const expression = typeof pattern === "string" ? compilePattern(pattern) : null;
    if (expression && !expression.test(value)) {
        return "pattern_mismatch";
    }
    return null;
}

function enumProblem(field, value) {
    return field.validation.entries.some(entry => entry.value === value) ? null : "not_in_enum";
}

// The problem with a value of the right type, if any.
function valueProblem(field, value) {
    switch (field.type) {
    case "enum":
        return enumProblem(field, value);
    case "integer":
    case "number":
        return numericProblem(field.validation, value);
    case "text":
        return textProblem(field.validation, value);
    default:
        return null;
    }
}

function deprecation(key, code, value, supersededBy) {
    return { field: key, code, value, supersededBy: supersededBy ?? null };
}

/**
 * Checks one configuration against a service's normalized descriptor fields.
 * Pure: no lifecycle policy, no stored design.
 * @param {object} configuration field key → scalar
 * @param {object[]} fields normalized descriptor fields (capability-descriptors.service.js)
 * @returns {{ problems: object[], deprecations: object[] }}
 *   problems: `{ field, code, value }`; deprecations: `{ field, code, value, supersededBy }`
 */
export function checkServiceConfiguration(configuration, fields) {
    const problems = [];
    const deprecations = [];
    const fieldsByKey = new Map(fields.map(field => [field.key, field]));

    for (const [key, value] of Object.entries(configuration)) {
        const field = fieldsByKey.get(key);
        if (!field) {
            problems.push({ field: key, code: "unknown_field", value });
            continue;
        }
        if (isUnset(value)) {
            continue; // the service default applies; `required` is checked below
        }

        const code = typeProblem(field, value) ?? valueProblem(field, value);
        if (code) {
            problems.push({ field: key, code, value });
            continue;
        }

        if (field.status === "deprecated") {
            deprecations.push(deprecation(key, "deprecated_field", value, field.supersededBy));
        }
        const entry = field.type === "enum"
            ? field.validation.entries.find(candidate => candidate.value === value)
            : null;
        if (entry?.status === "deprecated") {
            deprecations.push(deprecation(key, "deprecated_value", value, entry.supersededBy));
        }
    }

    for (const field of fields) {
        if (field.required && isUnset(configuration[field.key])) {
            problems.push({ field: field.key, code: "required", value: null });
        }
    }

    return { problems, deprecations };
}


function phasesOf(design) {
    return Array.isArray(design?.phases) ? design.phases : [];
}

// The configurations a save must validate: enabled services that have one.
// Configurations of services that are not enabled are kept but ignored (#729).
function configurationsToValidate(design) {
    const targets = [];
    phasesOf(design).forEach((phase, phaseIndex) => {
        const externalServices = isPlainObject(phase?.externalServices)
            ? phase.externalServices
            : {};
        const enabled = Array.isArray(externalServices.enabledServiceIds)
            ? externalServices.enabledServiceIds
            : [];
        const configurations = isPlainObject(externalServices.configurations)
            ? externalServices.configurations
            : {};

        for (const serviceId of new Set(enabled)) {
            if (isPlainObject(configurations[serviceId])) {
                targets.push({ phaseIndex, serviceId, configuration: configurations[serviceId] });
            }
        }
    });
    return targets;
}

function problemFingerprint(serviceId, problem) {
    return JSON.stringify([serviceId, problem.field, problem.code, problem.value ?? null]);
}

/**
 * Validates every enabled service configuration of `design` (#731).
 * @param {object} options
 * @param {object} options.design the design being saved
 * @param {object|null} [options.storedDesign] the design as stored before this save, if any
 * @param {(serviceId: string, locale: string) => Promise<object|null>}
 *   options.getInstanceConfiguration
 *   `ExternalServicesRegistry#getServiceInstanceConfiguration`
 * @returns {Promise<{ errors: object[], warnings: object[] }>} entries carry
 *   `phaseIndex` (0-based), `serviceId`, `field`, `code`, `value`, and for
 *   warnings `supersededBy` or `reason` where relevant
 */
export async function validateDesignServiceConfigurations({
    design,
    storedDesign = null,
    getInstanceConfiguration,
}) {
    const targets = configurationsToValidate(design);
    const errors = [];
    const warnings = [];
    if (targets.length === 0) {
        return { errors, warnings };
    }

    const serviceIds = [...new Set([
        ...targets.map(target => target.serviceId),
        ...configurationsToValidate(storedDesign).map(target => target.serviceId),
    ])];
    const descriptors = new Map(await Promise.all(serviceIds.map(async serviceId => [
        serviceId,
        await getInstanceConfiguration(serviceId, VALIDATION_LOCALE),
    ])));

    // Problems the stored design already had do not block this save.
    const storedProblems = new Set();
    for (const { serviceId, configuration } of configurationsToValidate(storedDesign)) {
        const descriptor = descriptors.get(serviceId);
        if (descriptor?.available) {
            const { problems } = checkServiceConfiguration(configuration, descriptor.fields);
            for (const problem of problems) {
                storedProblems.add(problemFingerprint(serviceId, problem));
            }
        }
    }

    for (const { phaseIndex, serviceId, configuration } of targets) {
        const descriptor = descriptors.get(serviceId);
        if (!descriptor?.available) {
            warnings.push({
                phaseIndex,
                serviceId,
                field:  null,
                code:   "not_validated",
                reason: descriptor ? descriptor.reason ?? "unavailable" : "no_descriptor",
            });
            continue;
        }

        const { problems, deprecations } =
            checkServiceConfiguration(configuration, descriptor.fields);
        for (const problem of problems) {
            if (storedProblems.has(problemFingerprint(serviceId, problem))) {
                warnings.push({
                    phaseIndex,
                    serviceId,
                    field:  problem.field,
                    code:   "no_longer_accepted",
                    reason: problem.code,
                    value:  problem.value,
                });
            } else {
                errors.push({ phaseIndex, serviceId, ...problem });
            }
        }
        for (const deprecation of deprecations) {
            warnings.push({ phaseIndex, serviceId, ...deprecation });
        }
    }

    return { errors, warnings };
}

// The 400 answer for a save whose check found errors.
export function invalidConfigurationResponse({ errors, warnings }) {
    return {
        status: 400,
        body:   {
            status:  "err",
            code:    INVALID_CONFIGURATION_CODE,
            message: "Some external service settings are not valid.",
            errors,
            warnings,
        },
    };
}
