import defaultPhaseStarter from "../../helpers/phase-start-helper.js";
import defaultPhaseClockNotifier from "../../helpers/phase-clock-notifier.js";
import { createPhaseDeadlineRunner, resolvePollIntervalMs } from "./phase-deadline-runner.js";
import { createPhaseDeadlineStore } from "./phase-deadline-store.js";

let phaseDeadlineRunner = null;

/**
 * Starts the phase deadline runner (#1113) of this process; called once by
 * the web server entry point, after Socket.IO is initialized, so that the
 * events of the phases it starts reach the clients connected to it. Other
 * process roles (the PDF render worker) never call it.
 * @returns {{ processDue: Function, start: Function, stop: Function }}
 */
export function startPhaseDeadlineRunner({ env = process.env } = {}) {
    if (!phaseDeadlineRunner) {
        phaseDeadlineRunner = createPhaseDeadlineRunner({
            store:          createPhaseDeadlineStore(),
            startNextPhase: request => defaultPhaseStarter.startNextPhase(request),
            notifier:       defaultPhaseClockNotifier,
            intervalMs:     resolvePollIntervalMs(env.ETHICAPP_PHASE_CLOCK_POLL_INTERVAL_MS),
        });
    }
    phaseDeadlineRunner.start();
    return phaseDeadlineRunner;
}

