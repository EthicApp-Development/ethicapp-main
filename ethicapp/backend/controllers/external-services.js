import express from "express";
import { requireRole } from "../helpers/auth-helper.js";
import externalServicesRegistry from "../services/external-services.service.js";

const router = express.Router();

router.get("/external-services", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    await externalServicesRegistry.initialize();
    return res.json({
        status: "ok",
        result: externalServicesRegistry.listServices(),
    });
});

router.get("/external-services/results", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    await externalServicesRegistry.initialize();
    return res.json({
        status: "ok",
        result: externalServicesRegistry.listResults(),
    });
});

export default router;
