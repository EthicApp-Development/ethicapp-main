"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import { dispatchCaseDocumentReady } from "../helpers/case-document-hooks-helper.js";
import {
    getCaseEvidenceInventory,
    saveReviewedEvidenceInventory,
} from "../helpers/case-evidence-inventories-helper.js";
import {
    EvidenceInventoryValidationError,
    normalizeEvidenceInventory,
} from "../helpers/evidence-inventory-document.js";
import externalServicesRegistry from "../services/external-services.service.js";

/**
 * Teacher endpoints for the evidence inventory of a case.
 *
 * Only the case creator can read or change the inventory: it is review
 * material for the teacher and must not be exposed to students or to other
 * teachers browsing public cases.
 */

// Must match the evidence inventory entry of external-services/manifest.json.
export const EVIDENCE_INVENTORY_SERVICE_ID = "argumentation-tutor-evidence-inventory";

const router = express.Router();

function parseCaseId(id) {
    const caseId = Number(id);
    return Number.isSafeInteger(caseId) && caseId > 0 ? caseId : null;
}

async function getOwnedCase(caseId, userId) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT c.id, c.language_code, prj.status AS render_status
            FROM ethical_cases AS c
            LEFT JOIN pdf_render_jobs AS prj
                ON prj.owner_type = 'case'
               AND prj.owner_id = c.id
            WHERE c.id = $1
              AND c.creator = $2;
        `,
        sqlParams: [
            rpg2.param("plain", caseId),
            rpg2.param("plain", userId),
        ],
    });

    return row?.id ? row : null;
}

async function getCaseText(caseId) {
    // Lazy import: the content helper opens a Redis connection when loaded.
    const { getCaseDocumentRawText } = await import("../helpers/case-document-content-helper.js");
    return getCaseDocumentRawText(caseId, { cache: null });
}

function isServiceEnabled() {
    return externalServicesRegistry.hasEnabledService(EVIDENCE_INVENTORY_SERVICE_ID);
}

function dispatchInventoryGeneration(caseId) {
    return dispatchCaseDocumentReady(caseId, { serviceIds: [EVIDENCE_INVENTORY_SERVICE_ID] });
}

const defaultDependencies = {
    getOwnedCase,
    getInventory: getCaseEvidenceInventory,
    saveReviewed: saveReviewedEvidenceInventory,
    getCaseText,
    isServiceEnabled,
    dispatch:     dispatchInventoryGeneration,
};

function errorResponse(status, message, code, extra = {}) {
    return { status, body: { status: "err", message, code, ...extra } };
}

const caseNotFound = () => errorResponse(404, "Case not found.", "CASE_NOT_FOUND");

function serializeInventoryState(caseRow, inventoryRow, serviceEnabled) {
    return {
        caseId:         Number(caseRow.id),
        serviceEnabled,
        // Status of the PDF render job (pending, processing, completed, failed),
        // or null when the case document was never queued for rendering.
        documentStatus: caseRow.render_status ?? null,
        documentReady:  caseRow.render_status === "completed",
        status:         inventoryRow?.status ?? "none",
        stale:          inventoryRow?.is_stale === true,
        inventory:      inventoryRow?.inventory ?? null,
        errorMessage:   inventoryRow?.error_message ?? null,
        generatedAt:    inventoryRow?.generated_at ?? null,
        reviewedAt:     inventoryRow?.reviewed_at ?? null,
        updatedAt:      inventoryRow?.updated_at ?? null,
    };
}

async function readCaseText(dependencies, caseId) {
    try {
        return await dependencies.getCaseText(caseId);
    } catch (error) {
        // No rendered text (for example, the PDF render failed): quotes of a
        // hand-made inventory are then reported as not found.
        console.warn(`[case-evidence-inventories] Case ${caseId} text is not available.`, error);
        return "";
    }
}

export async function getEvidenceInventoryForOwner({
    caseId,
    userId,
    dependencies = defaultDependencies,
}) {
    const caseRow = await dependencies.getOwnedCase(caseId, userId);
    if (!caseRow) {
        return caseNotFound();
    }

    const inventoryRow = await dependencies.getInventory(caseId);
    return {
        status: 200,
        body:   {
            status: "ok",
            result: serializeInventoryState(caseRow, inventoryRow, dependencies.isServiceEnabled()),
        },
    };
}

export async function saveEvidenceInventoryForOwner({
    caseId,
    userId,
    inventory,
    dependencies = defaultDependencies,
}) {
    const caseRow = await dependencies.getOwnedCase(caseId, userId);
    if (!caseRow) {
        return caseNotFound();
    }

    let normalizedInventory;
    try {
        normalizedInventory = normalizeEvidenceInventory(inventory, {
            caseText: await readCaseText(dependencies, caseId),
            language: caseRow.language_code || undefined,
        });
    } catch (error) {
        if (error instanceof EvidenceInventoryValidationError) {
            return errorResponse(
                400,
                "The evidence inventory is invalid.",
                "EVIDENCE_INVENTORY_INVALID",
                { details: error.details }
            );
        }
        throw error;
    }

    const savedRow = await dependencies.saveReviewed({
        caseId,
        inventory: normalizedInventory,
        userId,
    });
    if (!savedRow) {
        return errorResponse(
            409,
            "The evidence inventory is being generated. Try again when it finishes.",
            "EVIDENCE_INVENTORY_PROCESSING"
        );
    }

    return {
        status: 200,
        body:   {
            status: "ok",
            result: serializeInventoryState(caseRow, savedRow, dependencies.isServiceEnabled()),
        },
    };
}

export async function generateEvidenceInventoryForOwner({
    caseId,
    userId,
    dependencies = defaultDependencies,
}) {
    const caseRow = await dependencies.getOwnedCase(caseId, userId);
    if (!caseRow) {
        return caseNotFound();
    }

    if (!dependencies.isServiceEnabled()) {
        return errorResponse(
            503,
            "The evidence inventory service is not enabled.",
            "EVIDENCE_INVENTORY_SERVICE_DISABLED"
        );
    }

    if (caseRow.render_status !== "completed") {
        return errorResponse(
            409,
            "The case document text is not available.",
            "CASE_DOCUMENT_NOT_READY"
        );
    }

    const currentRow = await dependencies.getInventory(caseId);
    if (currentRow?.status === "processing" && currentRow.is_stale !== true) {
        return errorResponse(
            409,
            "The evidence inventory is already being generated.",
            "EVIDENCE_INVENTORY_PROCESSING"
        );
    }

    await dependencies.dispatch(caseId);

    const inventoryRow = await dependencies.getInventory(caseId);
    return {
        status: 202,
        body:   {
            status: "ok",
            result: serializeInventoryState(caseRow, inventoryRow, true),
        },
    };
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

router.get("/cases/:id/evidence-inventory", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    return sendResult(
        res,
        getEvidenceInventoryForOwner({ caseId, userId: req.session.uid }),
        "Failed to load the case evidence inventory"
    );
});

router.put("/cases/:id/evidence-inventory", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    return sendResult(
        res,
        saveEvidenceInventoryForOwner({
            caseId,
            userId:    req.session.uid,
            inventory: req.body?.inventory,
        }),
        "Failed to save the case evidence inventory"
    );
});

router.post("/cases/:id/evidence-inventory/generate", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    return sendResult(
        res,
        generateEvidenceInventoryForOwner({ caseId, userId: req.session.uid }),
        "Failed to request the case evidence inventory"
    );
});

export default router;
