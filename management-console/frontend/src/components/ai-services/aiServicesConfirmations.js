import { formatServiceList } from './aiServicesFormat.js';

// What the AI services page asks the administrator to confirm (epic #810,
// #841), as requestConfirmation() options of useSensitiveActionConfirmation.
// Each `action` receives the step-up fields and sends the write with them.

export function saveConnectionConfirmation({ t, values, saveConnection }) {
  return {
    title: t('pages.aiServices.connection.confirmSave.title'),
    description: t('pages.aiServices.connection.confirmSave.body', { baseUrl: values.baseUrl.trim() }),
    details: t('pages.aiServices.connection.confirmSave.details'),
    confirmLabel: t('pages.aiServices.connection.actions.save'),
    action: (stepUp) => saveConnection(values, stepUp)
  };
}

export function removeConnectionConfirmation({ t, removeConnection }) {
  return {
    title: t('pages.aiServices.connection.remove.title'),
    description: t('pages.aiServices.connection.remove.body'),
    details: t('pages.aiServices.connection.remove.policyKept'),
    confirmLabel: t('pages.aiServices.connection.remove.confirm'),
    confirmVariant: 'danger',
    action: (stepUp) => removeConnection(stepUp)
  };
}

export function savePolicyConfirmation({
  t, input, namesById, adapterNamesById = new Map(), createPolicyVersion
}) {
  const allowed = input.allowedServiceIds.length > 0
    ? t('pages.aiServices.services.confirmSave.allowed', {
      services: formatServiceList(input.allowedServiceIds, namesById)
    })
    : t('pages.aiServices.services.confirmSave.none');
  const disabledAdapterIds = input.disabledAdapterIds || [];
  const description = disabledAdapterIds.length > 0
    ? `${allowed} ${t('pages.aiServices.services.confirmSave.disabledAdapters', {
      adapters: formatServiceList(disabledAdapterIds, adapterNamesById)
    })}`
    : allowed;

  return {
    title: t('pages.aiServices.services.confirmSave.title'),
    description,
    details: t('pages.aiServices.services.launchNotice'),
    confirmLabel: t('pages.aiServices.services.confirmSave.confirm'),
    action: (stepUp) => createPolicyVersion(input, stepUp)
  };
}
