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
