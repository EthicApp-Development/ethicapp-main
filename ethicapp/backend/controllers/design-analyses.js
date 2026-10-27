import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import {
    getDesignAnalysis,
    listDesignAnalyses,
    reserveDesignAnalysisGeneration,
    saveReviewedDesignAnalysis,
} from "../helpers/design-analyses-helper.js";
import {
    buildDesignSavedContext,
    dispatchDesignSavedHook,
} from "../helpers/design-analyses-lifecycle-helper.js";
import { designLockedRefusal } from "../helpers/design-update.js";
import externalServicesRegistry from "../services/external-services.service.js";

/**
 * Teacher endpoints for the analyses of a design (see design_analyses, epic
 * #846).
 *
 * Only the design creator can read or change them, as for case analyses:
 * students get 403 from requireRole and other teachers get 404, also for
 * public designs. A locked design (used by a launched activity) keeps its
 * analyses as they are: it can be neither regenerated nor edited.
 */

function parseDesignId(id) {
    const designId = Number(id);
    return Number.isSafeInteger(designId) && designId > 0 ? designId : null;
}

async function getOwnedDesign(designId, userId) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT d.id, d.creator, d.locked, d.case_id, d.design,
                   c.language_code AS case_language_code
            FROM designs AS d
            LEFT JOIN ethical_cases AS c
                ON c.id = d.case_id
            WHERE d.id = $1
              AND d.creator = $2;
        `,
        sqlParams: [designId, userId],
    });

    return rows[0] || null;
}

// Whether the service is registered and declares the `design` scope. Usable
// or not: the analyses of a service that is no longer allowed stay readable.
async function isDesignService(serviceId) {
    await externalServicesRegistry.initialize();
    const service = externalServicesRegistry.getServiceById(serviceId);
    return Array.isArray(service?.scopes) && service.scopes.includes("design");
}

async function getValidator(serviceId) {
    await externalServicesRegistry.initialize();
    return externalServicesRegistry.getDesignAnalysisValidator(serviceId);
}

async function isServiceUsable(serviceId) {
    await externalServicesRegistry.initialize();
    return externalServicesRegistry.isServiceUsable(serviceId);
}

// A new generation sends design-saved to the reserved service only.
function dispatchGeneration(designRow, reservation, { userId }) {
    return dispatchDesignSavedHook(
        buildDesignSavedContext(designRow, { userId }),
        { reservations: [reservation] }
    );
}

const defaultDependencies = {
    getOwnedDesign,
    listAnalyses:      listDesignAnalyses,
    getAnalysis:       getDesignAnalysis,
    saveReviewed:      saveReviewedDesignAnalysis,
    reserveGeneration: reserveDesignAnalysisGeneration,
    isDesignService,
    getValidator,
    isServiceUsable,
    dispatchGeneration,
};

function errorResponse(status, message, code, extra = {}) {
    return { status, body: { status: "err", message, code, ...extra } };
}

const designNotFound = () => errorResponse(404, "Design not found.", "DESIGN_NOT_FOUND");

const analysisNotFound = () => errorResponse(
    404,
    "The design has no analysis from this service.",
    "DESIGN_ANALYSIS_NOT_FOUND"
);

const serviceNotFound = () => errorResponse(
    404,
    "The service does not analyse designs.",
    "DESIGN_ANALYSIS_SERVICE_NOT_FOUND"
);

const analysisProcessing = () => errorResponse(
    409,
    "The analysis is being generated. Try again when it finishes.",
    "DESIGN_ANALYSIS_PROCESSING"
);

function serializeDesignAnalysis(row, { withDocument = false } = {}) {
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

// Lists the analyses stored for the design with their status, without documents.
export async function listDesignAnalysesForOwner({
    designId,
    userId,
    dependencies = defaultDependencies,
}) {
    if (!await dependencies.getOwnedDesign(designId, userId)) {
        return designNotFound();
    }

    const rows = await dependencies.listAnalyses(designId);
    return okResponse(rows.map(row => serializeDesignAnalysis(row)));
}

export async function getDesignAnalysisForOwner({
    designId,
    serviceId,
    userId,
    dependencies = defaultDependencies,
}) {
    if (!await dependencies.getOwnedDesign(designId, userId)) {
        return designNotFound();
    }

    const row = await dependencies.getAnalysis({ designId, serviceId });
    if (!row) {
        return analysisNotFound();
    }

    return okResponse(serializeDesignAnalysis(row, { withDocument: true }));
}

/**
 * Stores a document edited by the teacher. The adapter's
 * validateDesignAnalysisDocument(document, { designId, caseId, languageCode,
 * design }) returns { document, documentSchema } with the document to store,
 * or { errors }. Services without a validator accept no edits, which is every
 * service for now (epic #846: analyses of designs are read-only).
 */
export async function saveDesignAnalysisForOwner({
    designId,
    serviceId,
    userId,
    document,
    dependencies = defaultDependencies,
}) {
    const designRow = await dependencies.getOwnedDesign(designId, userId);
    if (!designRow) {
        return designNotFound();
    }

    const row = await dependencies.getAnalysis({ designId, serviceId });
    if (!row) {
        return analysisNotFound();
    }

    const validate = await dependencies.getValidator(serviceId);
    if (!validate) {
        return errorResponse(
            405,
            "This analysis cannot be edited.",
            "DESIGN_ANALYSIS_NOT_EDITABLE"
        );
    }

    if (designRow.locked === true) {
        return designLockedRefusal();
    }

    const validation = await validate(document, {
        designId,
        caseId:       designRow.case_id ?? null,
        languageCode: designRow.case_language_code ?? null,
        design:       designRow.design ?? null,
    });
    if (!validation || validation.errors) {
        return errorResponse(
            400,
            "The analysis document is invalid.",
            "DESIGN_ANALYSIS_DOCUMENT_INVALID",
            { details: validation?.errors ?? [] }
        );
    }

    const savedRow = await dependencies.saveReviewed({
        designId,
        serviceId,
        documentSchema: validation.documentSchema ?? row.document_schema ?? null,
        document:       validation.document,
        userId,
    });
    if (!savedRow) {
        return analysisProcessing();
    }

    return okResponse(serializeDesignAnalysis(
        { ...savedRow, document: validation.document },
        { withDocument: true }
    ));
}

/**
 * Requests a new generation from one design-scoped service, which replaces the
 * current analysis when its result arrives. It also recovers stale
 * generations. The first generation of a service creates its analysis.
 */
export async function generateDesignAnalysisForOwner({
    designId,
    serviceId,
    userId,
    dependencies = defaultDependencies,
}) {
    const designRow = await dependencies.getOwnedDesign(designId, userId);
    if (!designRow) {
        return designNotFound();
    }

    if (!await dependencies.isDesignService(serviceId)) {
        return serviceNotFound();
    }

    // Launched activities use the analyses of a locked design.
    if (designRow.locked === true) {
        return designLockedRefusal();
    }

    if (!await dependencies.isServiceUsable(serviceId)) {
        return errorResponse(
            503,
            "The analysis service is not enabled.",
            "DESIGN_ANALYSIS_SERVICE_DISABLED"
        );
    }

    // One conditional statement checks and reserves, so of two concurrent
    // requests only one is accepted. No input hash is computed here yet: the
    // adapters' input export comes with analyses on save (#848).
    const reservation = await dependencies.reserveGeneration({
        designId,
        serviceId,
        inputHash: null,
        userId,
    });
    if (!reservation) {
        return analysisProcessing();
    }

    // Fire-and-forget: the adapter records its progress in the analysis row.
    dependencies.dispatchGeneration(designRow, reservation, { userId });

    return okResponse(serializeDesignAnalysis(reservation), 202);
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

// Every route is for teachers only and needs a numeric design id.
function teacherDesignRoute(handler, errorMessage) {
    return async (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }

        const designId = parseDesignId(req.params.id);
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Invalid design id." });
        }

        return sendResult(res, handler({ req, designId, userId: req.session.uid }), errorMessage);
    };
}

// `dependencies` replaces the database and registry access in tests.
export function createDesignAnalysesRouter(dependencies = defaultDependencies) {
    const router = express.Router();

    router.get("/designs/:id/analyses", teacherDesignRoute(
        ({ designId, userId }) => listDesignAnalysesForOwner({ designId, userId, dependencies }),
        "Failed to load the design analyses"
    ));

    router.get("/designs/:id/analyses/:serviceId", teacherDesignRoute(
        ({ req, designId, userId }) => getDesignAnalysisForOwner({
            designId,
            serviceId: req.params.serviceId,
            userId,
            dependencies,
        }),
        "Failed to load the design analysis"
    ));

    router.put("/designs/:id/analyses/:serviceId", teacherDesignRoute(
        ({ req, designId, userId }) => saveDesignAnalysisForOwner({
            designId,
            serviceId: req.params.serviceId,
            userId,
            document:  req.body?.document,
            dependencies,
        }),
        "Failed to save the design analysis"
    ));

    router.post("/designs/:id/analyses/:serviceId/generate", teacherDesignRoute(
        ({ req, designId, userId }) => generateDesignAnalysisForOwner({
            designId,
            serviceId: req.params.serviceId,
            userId,
            dependencies,
        }),
        "Failed to request the design analysis"
    ));

    return router;
}

export default createDesignAnalysesRouter();
