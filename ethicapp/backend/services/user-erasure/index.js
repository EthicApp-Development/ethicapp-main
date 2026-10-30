import externalServicesRegistry from "../external-services.service.js";
import { createUserErasureProcessor } from "./user-erasure-processor.js";
import { userErasureRequestsStore } from "./user-erasure-requests.store.js";

export { ERASURE_REQUEST_STATUS } from "./user-erasure-requests.store.js";

// The processor of the ethicapp web process (see user-erasure-processor.js).
export const userErasureProcessor = createUserErasureProcessor({
    registry: externalServicesRegistry,
    store:    userErasureRequestsStore,
});

export { userErasureRequestsStore };

// Starts the periodic processing; called once by the web server entry point.
export function startUserErasureProcessor() {
    userErasureProcessor.start();
    return userErasureProcessor;
}
