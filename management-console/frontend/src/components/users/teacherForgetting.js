// What the console tells an administrator about forgetting a teacher (#877),
// without React: the plan built from the backend's preview, and the summary
// the step-up dialog repeats.

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * The lines of the plan, in order, as { id, text, variant }, where variant is
 * `warning` for what the administrator must notice.
 * @param {object} preview - { openActivities: { ok, count }, cases, designs,
 *     activities, copiesByOthers } from the preview endpoint.
 * @param {object|null} recipient - { id, name, email } or null.
 * @param {number|string} userId
 * @param {Function} t
 */
export function teacherForgetPlan(preview, recipient, userId, t) {
  const prefix = 'pages.userForgetTeacher.plan';
  const open = preview?.openActivities || {};
  const kept = {
    cases: count(preview?.cases?.keep),
    designs: count(preview?.designs?.keep),
    activities: count(preview?.activities)
  };

  return [
    open.ok
      ? { id: 'openActivities', text: t(`${prefix}.openActivities`, { count: count(open.count) }) }
      : {
          id: 'openActivities',
          variant: 'warning',
          text: t(`${prefix}.openActivitiesUnavailable`, { count: count(open.count) })
        },
    { id: 'casesDeleted', text: t(`${prefix}.casesDeleted`, { count: count(preview?.cases?.delete) }) },
    { id: 'designsDeleted', text: t(`${prefix}.designsDeleted`, { count: count(preview?.designs?.delete) }) },
    recipient
      ? { id: 'kept', text: t(`${prefix}.keptWithRecipient`, { ...kept, name: recipient.name }) }
      : { id: 'kept', text: t(`${prefix}.keptWithoutRecipient`, kept) },
    {
      id: 'copies',
      text: t(`${prefix}.copies`, {
        cases: count(preview?.copiesByOthers?.cases),
        designs: count(preview?.copiesByOthers?.designs)
      })
    },
    { id: 'attribution', text: t(`${prefix}.attribution`) },
    { id: 'account', text: t(`${prefix}.account`, { id: userId }) }
  ];
}

/**
 * The details the step-up dialog lists, from the plan the administrator
 * accepted.
 */
export function teacherForgetConfirmDetails(preview, recipient, t) {
  const prefix = 'pages.userForgetTeacher.confirm';

  return [
    t(`${prefix}.detailActivities`, { count: count(preview?.openActivities?.count) }),
    t(`${prefix}.detailDeleted`, {
      cases: count(preview?.cases?.delete),
      designs: count(preview?.designs?.delete)
    }),
    recipient
      ? t(`${prefix}.detailRecipient`, { name: recipient.name, email: recipient.email })
      : t(`${prefix}.detailNoRecipient`),
    t(`${prefix}.detailAccount`)
  ];
}

// The recipient as the dialog shows it, from a row of the users list.
export function recipientFromUser(user) {
  const name = `${user?.firstname || ''} ${user?.lastname || ''}`.trim() || user?.email || '';
  return { id: Number(user?.id), name, email: user?.email || '' };
}
