export const EXTERNAL_RESPONSE_PROCESSING_TIMEOUT_MS = 95000;

function normalizeServiceId(serviceId) {
  return typeof serviceId === 'string' ? serviceId.trim() : '';
}

export function serviceProcessesStudentResponses(service) {
  return service?.enabled !== false
    && normalizeServiceId(service?.id).length > 0
    && service?.capabilities?.processesStudentResponses === true;
}

export function buildResponseProcessingServiceCatalog(services) {
  const catalog = new Map();

  if (!Array.isArray(services)) {
    return catalog;
  }

  services.forEach((service) => {
    if (!serviceProcessesStudentResponses(service)) {
      return;
    }

    catalog.set(normalizeServiceId(service.id), service);
  });

  return catalog;
}

export function getEnabledExternalServiceIdsForPhase({ design, phase }) {
  const phaseNumber = Number(phase?.number);
  const designPhases = Array.isArray(design?.phases) ? design.phases : [];

  if (!Number.isInteger(phaseNumber) || phaseNumber <= 0) {
    return [];
  }

  const phaseDesign = designPhases[phaseNumber - 1];
  const enabledServiceIds = Array.isArray(phaseDesign?.externalServices?.enabledServiceIds)
    ? phaseDesign.externalServices.enabledServiceIds
    : [];

  return enabledServiceIds
    .map(normalizeServiceId)
    .filter(Boolean);
}

export function buildResponseProcessingServicesByPhase({ phases, design, services }) {
  const serviceCatalog = buildResponseProcessingServiceCatalog(services);
  const byPhaseId = {};

  if (!Array.isArray(phases) || serviceCatalog.size === 0) {
    return byPhaseId;
  }

  phases.forEach((phase) => {
    const phaseId = Number(phase?.id);
    if (!Number.isInteger(phaseId) || phaseId <= 0) {
      return;
    }

    const serviceIds = getEnabledExternalServiceIdsForPhase({ design, phase })
      .filter((serviceId) => serviceCatalog.has(serviceId));

    if (serviceIds.length > 0) {
      byPhaseId[phaseId] = serviceIds;
    }
  });

  return byPhaseId;
}

export function applyResponseProcessingDelta(previous, { phaseId, serviceId, delta }) {
  const normalizedPhaseId = Number(phaseId);
  const normalizedServiceId = normalizeServiceId(serviceId);
  const normalizedDelta = Number(delta);

  if (
    !Number.isInteger(normalizedPhaseId)
    || normalizedPhaseId <= 0
    || !normalizedServiceId
    || !Number.isFinite(normalizedDelta)
    || normalizedDelta === 0
  ) {
    return previous;
  }

  const phaseKey = String(normalizedPhaseId);
  const previousPhase = previous?.[phaseKey] ?? {};
  const currentCount = Number(previousPhase[normalizedServiceId]) || 0;
  const nextCount = Math.max(0, currentCount + normalizedDelta);
  const nextPhase = { ...previousPhase };

  if (nextCount > 0) {
    nextPhase[normalizedServiceId] = nextCount;
  } else {
    delete nextPhase[normalizedServiceId];
  }

  const nextState = { ...(previous ?? {}) };
  if (Object.keys(nextPhase).length > 0) {
    nextState[phaseKey] = nextPhase;
  } else {
    delete nextState[phaseKey];
  }

  return nextState;
}

export function buildResponseProcessingByPhase(pendingByPhaseId) {
  const processingByPhaseId = {};

  Object.entries(pendingByPhaseId ?? {}).forEach(([phaseIdRaw, services]) => {
    const phaseId = Number(phaseIdRaw);
    if (!Number.isInteger(phaseId) || phaseId <= 0 || !services || typeof services !== 'object') {
      return;
    }

    processingByPhaseId[phaseId] = Object.values(services)
      .some((count) => Number(count) > 0);
  });

  return processingByPhaseId;
}
