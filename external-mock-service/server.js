import express from "express";
import { buildMockReview, DOCUMENT_SCHEMA } from "./student-result.js";

const app = express();
const port = Number(process.env.PORT || 8510);

app.use(express.json({ limit: "1mb" }));

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "ethicapp-external-mock-service" });
});

// The mock review of a student response, as a student-result/v1 document in
// `locale` (es-CL or en-US; anything else gives es-CL). See student-result.js.
app.post("/response-review/student-result", (req, res) => {
    const { document, analysis } = buildMockReview({
        text:   normalizeText(req.body?.text),
        locale: req.body?.locale,
    });

    res.json({
        status:         "completed",
        documentSchema: DOCUMENT_SCHEMA,
        document,
        analysis,
    });
});

app.post("/chat-agent/respond", (req, res) => {
    const content = normalizeText(req.body?.content);
    const processedMessage = content ? Array.from(content).reverse().join("") : "empty-message";
    const characterCount = content.length;

    res.json({
        status:  "completed",
        message: `${processedMessage} (${characterCount})`,
        payload: {
            processedMessage,
            characterCount,
            groupId: req.body?.groupId ?? null,
            phaseId: req.body?.phaseId ?? null,
        },
    });
});

app.use((req, res) => {
    res.status(404).json({ status: "err", error: "Not found" });
});

app.listen(port, () => {
    console.info(`[external-mock-service] Listening on port ${port}`);
});
