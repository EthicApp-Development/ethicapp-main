/**
 * Dispatches reserved analysis generations (case or design analyses): each
 * reserved service receives `hookName` under the job id of its reservation,
 * which its adapter starts before its handler settles. Without reservations
 * nothing is dispatched. Errors are logged and swallowed so adapter failures
 * never affect the request that reserved the generations.
 *
 * Once a service's dispatch settles, `release(reservation)` releases its
 * reservation if it was not started: the service has no handler, the dispatch
 * failed, or the handler failed or returned before starting it. Otherwise it
 * would block the analysis until it is stale.
 *
 * @param {string} hookName - The hook to dispatch.
 * @param {Object} context - The hook context.
 * @param {Object} options
 * @param {Array<{service_id: string, job_id: string}>} options.reservations - Reserved rows.
 * @param {Object} options.registry - The external services registry.
 * @param {Function} options.release - Releases one reservation if it was not started.
 * @returns {Promise<Array>} Settled handler outcomes, or [] when nothing ran.
 */
export async function dispatchReservedGenerations(
    hookName,
    context,
    { reservations = [], registry, release }
) {
    // One dispatch per reservation, so each is released as soon as its own
    // handler settles rather than after the slowest one.
    const outcomes = await Promise.all(reservations.map(reservation =>
        dispatchReservation(hookName, context, reservation, { registry, release })
    ));

    return outcomes.flat();
}

async function dispatchReservation(hookName, context, reservation, { registry, release }) {
    const { service_id: serviceId, job_id: jobId } = reservation;
    let outcomes = [];

    try {
        outcomes = await registry.dispatchHook(hookName, context, {
            enabledServiceIds: [serviceId],
            jobIds:            { [serviceId]: jobId },
        });
    } catch (error) {
        console.error(`[external-services] Error dispatching ${hookName} hook.`, error);
    }

    try {
        await release(reservation);
    } catch (error) {
        console.error(`[external-services] Could not release the ${serviceId} reservation.`, error);
    }

    return outcomes;
}
