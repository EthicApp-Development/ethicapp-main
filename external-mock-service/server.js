import express from "express";

const app = express();
const port = Number(process.env.PORT || 8510);

app.use(express.json({ limit: "1mb" }));

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "ethicapp-external-mock-service" });
});

app.post("/response-review/reverse", (req, res) => {
    const text = normalizeText(req.body?.text);
    const reversedText = Array.from(text).reverse().join("");

    res.json({
        status: "completed",
        summary: reversedText || "No text was provided.",
        payload: {
            originalText: text,
            reversedText,
            characterCount: text.length,
        },
    });
});

app.post("/chat-agent/respond", (req, res) => {
    const content = normalizeText(req.body?.content);
    const processedMessage = content ? Array.from(content).reverse().join("") : "empty-message";
    const characterCount = content.length;

    res.json({
        status: "completed",
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
