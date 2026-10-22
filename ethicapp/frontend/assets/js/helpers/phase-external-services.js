// The external services part of a design phase (#729):
//
//   externalServices: {
//       enabledServiceIds: ["polyadic-devils-advocate"],
//       configurations: {
//           "polyadic-devils-advocate": { pipeline_type: "devilsAdvocate", llm_tier: "basic" }
//       }
//   }
//
// `configurations` is keyed by manifest service id; each value maps capability
// descriptor field keys to scalars (canonical-schemas/ethicapp-v1.schema.json).
// Turning a service off keeps its configuration, so turning it on again restores
// the teacher's values.

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function emptyExternalServicesConfig() {
    return { enabledServiceIds: [], configurations: {} };
}

// Gives `phase.externalServices` the expected shape in place, keeping every
// valid value, and returns it.
export function normalizeExternalServicesConfig(phase) {
    if (!isPlainObject(phase.externalServices)) {
        phase.externalServices = emptyExternalServicesConfig();
    }

    const externalServices = phase.externalServices;
    if (!Array.isArray(externalServices.enabledServiceIds)) {
        externalServices.enabledServiceIds = [];
    }
    if (!isPlainObject(externalServices.configurations)) {
        externalServices.configurations = {};
    }

    return externalServices;
}
