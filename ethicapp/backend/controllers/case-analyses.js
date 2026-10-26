import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import {
    getCaseAnalysis,
    listCaseAnalyses,
    reserveCaseAnalysisGeneration,
    saveReviewedCaseAnalysis,
} from "../helpers/case-analyses-helper.js";
import {
    buildCaseCreatedContext,
    dispatchCaseCreatedHook,
} from "../helpers/case-lifecycle-helper.js";
import externalServicesRegistry from "../services/external-services.service.js";

/**
 * Teacher endpoints for the analyses chosen for a case (see case_analyses).
 *
 * Only the case creator can read or change them: they are review material for
 * the teacher and must not be exposed to students or to other teachers browsing
 * public cases. Students get 403 from requireRole and other teachers get 404.
 */

function parseCaseId(id) {
    const caseId = Number(id);
    return Number.isSafeInteger(caseId) && caseId > 0 ? caseId : null;
}

async function getOwnedCase(caseId, userId) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT c.id, c.case_uuid, c.title, c.pdf_path, c.creator, c.language_code,
                   c.visibility, prj.id AS pdf_render_job_id
            FROM ethical_cases AS c
            LEFT JOIN pdf_render_jobs AS prj
                ON prj.owner_type = 'case'
               AND prj.owner_id = c.id
            WHERE c.id = $1
              AND c.creator = $2;
        `,
        sqlParams: [caseId, userId],
    });

    return rows[0] || null;
}

async function getCaseText(caseId) {
    // Lazy import: the content helper opens a Redis connection when loaded.
    const { getCaseDocumentRawText } = await import("../helpers/case-document-content-helper.js");
    // Bypass the cached text: it may belong to a previous version of the PDF.
    return getCaseDocumentRawText(caseId, { cache: null });
}

async function getValidator(serviceId) {
    await externalServicesRegistry.initialize();
    return externalServicesRegistry.getCaseAnalysisValidator(serviceId);
}

async function isServiceUsable(serviceId) {
    await externalServicesRegistry.initialize();
    return externalServicesRegistry.isServiceUsable(serviceId);
}

// A new generation replays case-created for the reserved service only, so the
// other services chosen for the case are not triggered again.
function dispatchGeneration(caseRow, reservation) {
    return dispatchCaseCreatedHook(buildCaseCreatedContext(caseRow, {
        userId:         caseRow.creator,
        pdfRenderJobId: caseRow.pdf_render_job_id ?? null,
    }), { reservations: [reservation] });
}

const defaultDependencies = {
    getOwnedCase,
    listAnalyses:      listCaseAnalyses,
    getAnalysis:       getCaseAnalysis,
    saveReviewed:      saveReviewedCaseAnalysis,
    reserveGeneration: reserveCaseAnalysisGeneration,
    getValidator,
    isServiceUsable,
    getCaseText,
    dispatchGeneration,
};

function errorResponse(status, message, code, extra = {}) {
    return { status, body: { status: "err", message, code, ...extra } };
}

const caseNotFound = () => errorResponse(404, "Case not found.", "CASE_NOT_FOUND");

const analysisNotFound = () => errorResponse(
    404,
    "The service was not chosen for this case.",
    "CASE_ANALYSIS_NOT_FOUND"
);

const analysisProcessing = () => errorResponse(
    409,
    "The analysis is being generated. Try again when it finishes.",
    "CASE_ANALYSIS_PROCESSING"
);

function serializeCaseAnalysis(row, { withDocument = false } = {}) {
    const analysis = {
        serviceId:      row.service_id,
        status:         row.status,
        stale:          row.is_stale === true,
        documentSchema: row.document_schema ?? null,
        errorCode:      row.error_code ?? null,
        errorMessage:   row.error_message ?? null,
        requestedAt:    row.requested_at ?? null,
        generatedAt:    row.generated_at ?? null,
        reviewedAt:     row.reviewed_at ?? null,
        updatedAt:      row.updated_at ?? null,
    };

    return withDocument ? { ...analysis, document: row.document ?? null } : analysis;
}

function okResponse(result, status = 200) {
    return { status, body: { status: "ok", result } };
}

// Lists the services chosen for the case with their status, without documents.
export async function listCaseAnalysesForOwner({
    caseId,
    userId,
    dependencies = defaultDependencies,
}) {
    if (!await dependencies.getOwnedCase(caseId, userId)) {
        return caseNotFound();
    }

    const rows = await dependencies.listAnalyses(caseId);
    return okResponse(rows.map(row => serializeCaseAnalysis(row)));
}

export async function getCaseAnalysisForOwner({
    caseId,
    serviceId,
    userId,
    dependencies = defaultDependencies,
}) {
    if (!await dependencies.getOwnedCase(caseId, userId)) {
        return caseNotFound();
    }

    const row = await dependencies.getAnalysis({ caseId, serviceId });
    if (!row) {
        return analysisNotFound();
    }

    return okResponse(serializeCaseAnalysis(row, { withDocument: true }));
}

/**
 * Stores a document edited by the teacher. The adapter's
 * validateCaseAnalysisDocument(document, { caseId, languageCode, getCaseText })
 * returns { document, documentSchema } with the document to store, or { errors }.
 * Services without a validator accept no edits.
 */
export async function saveCaseAnalysisForOwner({
    caseId,
    serviceId,
    userId,
    document,
    dependencies = defaultDependencies,
}) {
    const caseRow = await dependencies.getOwnedCase(caseId, userId);
    if (!caseRow) {
        return caseNotFound();
    }

    const row = await dependencies.getAnalysis({ caseId, serviceId });
    if (!row) {
        return analysisNotFound();
    }

    const validate = await dependencies.getValidator(serviceId);
    if (!validate) {
        return errorResponse(405, "This analysis cannot be edited.", "CASE_ANALYSIS_NOT_EDITABLE");
    }

    const validation = await validate(document, {
        caseId,
        languageCode: caseRow.language_code ?? null,
        getCaseText:  () => dependencies.getCaseText(caseId),
    });
    if (!validation || validation.errors) {
        return errorResponse(
            400,
            "The analysis document is invalid.",
            "CASE_ANALYSIS_DOCUMENT_INVALID",
            { details: validation?.errors ?? [] }
        );
    }

    const savedRow = await dependencies.saveReviewed({
        caseId,
        serviceId,
        documentSchema: validation.documentSchema ?? row.document_schema ?? null,
        document:       validation.document,
        userId,
    });
    if (!savedRow) {
        return analysisProcessing();
    }

    return okResponse(serializeCaseAnalysis(
        { ...savedRow, document: validation.document },
        { withDocument: true }
    ));
}

/**
 * Requests a new generation from one chosen service. It also recovers stale
 * generations, for example ones lost while waiting for the PDF render.
 */
export async function generateCaseAnalysisForOwner({
    caseId,
    serviceId,
    userId,
    dependencies = defaultDependencies,
}) {
    const caseRow = await dependencies.getOwnedCase(caseId, userId);
    if (!caseRow) {
        return caseNotFound();
    }

    const row = await dependencies.getAnalysis({ caseId, serviceId });
    if (!row) {
        return analysisNotFound();
    }

    if (!await dependencies.isServiceUsable(serviceId)) {
        return errorResponse(
            503,
            "The analysis service is not enabled.",
            "CASE_ANALYSIS_SERVICE_DISABLED"
        );
    }

    // The reservation is a single conditional update, so of two concurrent
    // requests only one is accepted, and edits are refused from now on.
    const reservation = await dependencies.reserveGeneration({ caseId, serviceId });
    if (!reservation) {
        return analysisProcessing();
    }

    // Fire-and-forget: the adapter records its progress in the analysis row.
    dependencies.dispatchGeneration(caseRow, reservation);

    return okResponse(serializeCaseAnalysis(reservation), 202);
}

async function sendResult(res, resultPromise, errorMessage) {
    try {
        const { status, body } = await resultPromise;
        return res.status(status).json(body);
    } catch (error) {
        console.error(`${errorMessage}:`, error);
        return res.status(500).json({ status: "err", message: `${errorMessage}.` });
    }
}

// Every route is for teachers only and needs a numeric case id.
function teacherCaseRoute(handler, errorMessage) {
    return async (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }

        const caseId = parseCaseId(req.params.id);
        if (!caseId) {
            return res.status(400).json({ status: "err", message: "Invalid case id." });
        }

        return sendResult(res, handler({ req, caseId, userId: req.session.uid }), errorMessage);
    };
}

// `dependencies` replaces the database and registry access in tests.
export function createCaseAnalysesRouter(dependencies = defaultDependencies) {
    const router = express.Router();

    router.get("/cases/:id/analyses", teacherCaseRoute(
        ({ caseId, userId }) => listCaseAnalysesForOwner({ caseId, userId, dependencies }),
        "Failed to load the case analyses"
    ));

    router.get("/cases/:id/analyses/:serviceId", teacherCaseRoute(
        ({ req, caseId, userId }) => getCaseAnalysisForOwner({
            caseId,
            serviceId: req.params.serviceId,
            userId,
            dependencies,
        }),
        "Failed to load the case analysis"
    ));

    router.put("/cases/:id/analyses/:serviceId", teacherCaseRoute(
        ({ req, caseId, userId }) => saveCaseAnalysisForOwner({
            caseId,
            serviceId: req.params.serviceId,
            userId,
            document:  req.body?.document,
            dependencies,
        }),
        "Failed to save the case analysis"
    ));

    router.post("/cases/:id/analyses/:serviceId/generate", teacherCaseRoute(
        ({ req, caseId, userId }) => generateCaseAnalysisForOwner({
            caseId,
            serviceId: req.params.serviceId,
            userId,
            dependencies,
        }),
        "Failed to request the case analysis"
    ));

    return router;
}

export default createCaseAnalysesRouter();
