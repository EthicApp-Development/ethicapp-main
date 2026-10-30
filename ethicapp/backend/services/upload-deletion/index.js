import { createUploadDeletionProcessor } from "./upload-deletion-processor.js";
import { uploadDeletionRequestsStore } from "./upload-deletion-requests.store.js";

export { UPLOAD_DELETION_STATUS } from "./upload-deletion-requests.store.js";

// The processor of the ethicapp web process (see upload-deletion-processor.js).
export const uploadDeletionProcessor = createUploadDeletionProcessor({
    store: uploadDeletionRequestsStore,
});

export { uploadDeletionRequestsStore };

// Starts the periodic processing; called once by the web server entry point.
export function startUploadDeletionProcessor() {
    uploadDeletionProcessor.start();
    return uploadDeletionProcessor;
}
