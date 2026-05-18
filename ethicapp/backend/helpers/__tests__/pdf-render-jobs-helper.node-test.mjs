import assert from "node:assert/strict";
import test from "node:test";

import { normalizePdfRenderJob } from "../pdf-render-jobs-helper.js";

test("normalizePdfRenderJob returns null when a case has no render job", () => {
    assert.equal(normalizePdfRenderJob({ id: 12, title: "Case without job" }), null);
    assert.equal(normalizePdfRenderJob(null), null);
});

test("normalizePdfRenderJob exposes the backend document processing contract", () => {
    const requestedAt = new Date("2026-05-18T12:00:00.000Z");
    const job = normalizePdfRenderJob({
        pdf_render_job_id:            7,
        pdf_render_owner_type:        "case",
        pdf_render_owner_id:          12,
        pdf_render_source_path:       "/uploads/cases/12/case.pdf",
        pdf_render_source_sha256:     "a".repeat(64),
        pdf_render_source_byte_count: 12345,
        pdf_render_status:            "pending",
        pdf_render_requested_at:      requestedAt,
        pdf_render_next_attempt_at:   requestedAt,
        pdf_render_started_at:        null,
        pdf_render_completed_at:      null,
        pdf_render_attempt_count:     0,
        pdf_render_max_attempts:      3,
        pdf_render_page_count:        null,
        pdf_render_manifest_path:     null,
        pdf_render_error_message:     null,
        pdf_render_metadata:          { reason: "case_pdf_uploaded" },
    });

    assert.deepEqual(job, {
        id:              7,
        ownerType:       "case",
        ownerId:         12,
        sourcePath:      "/uploads/cases/12/case.pdf",
        sourceSha256:    "a".repeat(64),
        sourceByteCount: 12345,
        status:          "pending",
        requestedAt,
        nextAttemptAt:   requestedAt,
        startedAt:       null,
        completedAt:     null,
        attemptCount:    0,
        maxAttempts:     3,
        pageCount:       null,
        manifestPath:    null,
        errorMessage:    null,
        metadata:        { reason: "case_pdf_uploaded" },
    });
});
