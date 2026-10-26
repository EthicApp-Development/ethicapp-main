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
//   with a `not_validated` warning;
// - an enabled service the AI service policy does not allow now (#815) is kept
//   with a `not_allowed` warning, and its configuration is not validated.
//
// Only new problems are errors. The editor maps both lists to field messages;
// see external-services/README.md, "Configuration validation".

import { checkServiceConfiguration } from "../../common/modules/service-configuration-rules.js";

export { checkServiceConfiguration };

export const INVALID_CONFIGURATION_CODE = "INVALID_SERVICE_CONFIGURATION";

// Validation does not depend on display text, so descriptors are read in one
// fixed locale and share one cache entry per service.
const VALIDATION_LOCALE = "en_US";

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function phasesOf(design) {
    return Array.isArray(design?.phases) ? design.phases : [];
}

function enabledServiceIdsOf(phase) {
    const enabled = phase?.externalServices?.enabledServiceIds;
    return Array.isArray(enabled) ? [...new Set(enabled)] : [];
}

/**
 * Every service id the design enables in any phase, once.
 * @param {object} design
 * @returns {string[]}
 */
export function designEnabledServiceIds(design) {
    return [...new Set(phasesOf(design).flatMap(enabledServiceIdsOf))];
}

/**
 * One `not_allowed` warning per phase and enabled service that is not usable
 * (#815): the design keeps it, and it will not run while the AI service policy
 * does not allow it. Unknown services are not usable either.
 * @param {object} design
 * @param {Iterable<string>} usableServiceIds
 * @returns {object[]} `{ phaseIndex, serviceId, field: null, code: "not_allowed" }`
 */
export function notAllowedServiceWarnings(design, usableServiceIds) {
    const usable = new Set(usableServiceIds);
    return phasesOf(design).flatMap((phase, phaseIndex) => enabledServiceIdsOf(phase)
        .filter(serviceId => !usable.has(serviceId))
        .map(serviceId => ({ phaseIndex, serviceId, field: null, code: "not_allowed" })));
}

// The configurations a save must validate: enabled services that have one.
// Configurations of services that are not enabled are kept but ignored (#729).
function configurationsToValidate(design) {
    const targets = [];
    phasesOf(design).forEach((phase, phaseIndex) => {
        const configurations = isPlainObject(phase?.externalServices?.configurations)
            ? phase.externalServices.configurations
            : {};

        for (const serviceId of enabledServiceIdsOf(phase)) {
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
 * @param {Iterable<string>|null} [options.usableServiceIds] the services usable
 *   now (#815). When given, every other enabled service gets a `not_allowed`
 *   warning and its configuration is not validated.
 * @returns {Promise<{ errors: object[], warnings: object[] }>} entries carry
 *   `phaseIndex` (0-based), `serviceId`, `field`, `code`, `value`, and for
 *   warnings `supersededBy` or `reason` where relevant
 */
export async function validateDesignServiceConfigurations({
    design,
    storedDesign = null,
    getInstanceConfiguration,
    usableServiceIds = null,
}) {
    const usable = usableServiceIds === null ? null : new Set(usableServiceIds);
    const isUsable = serviceId => usable === null || usable.has(serviceId);
    const targets = configurationsToValidate(design).filter(target => isUsable(target.serviceId));
    const errors = [];
    const warnings = usable === null ? [] : notAllowedServiceWarnings(design, usable);
    if (targets.length === 0) {
        return { errors, warnings };
    }

    const serviceIds = [...new Set([
        ...targets.map(target => target.serviceId),
        ...configurationsToValidate(storedDesign)
            .map(target => target.serviceId)
            .filter(isUsable),
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
