import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const { planTurn, completeAfterConsent } = await import("./agentEngine.js");
const { AGENT_ID } = await import("./mcpClient.js");

// Cloud Run injects PORT at deploy time; AGENT_SERVICE_PORT is the local-dev knob.
const PORT = process.env.PORT || process.env.AGENT_SERVICE_PORT || 8081;
const FRONTDOOR_TO_AGENT_KEY = process.env.FRONTDOOR_TO_AGENT_KEY;

if (!FRONTDOOR_TO_AGENT_KEY) {
  throw new Error("FRONTDOOR_TO_AGENT_KEY must be set (see .env.example)");
}

const app = express();
app.use(cors());
app.use(express.json());

// Stands in for Agent Gateway ingress mode: only the front door's identity
// (here, a shared key) may invoke this agent. Everything else is denied.
function requireFrontdoor(req, res, next) {
  if (req.headers["x-frontdoor-key"] !== FRONTDOOR_TO_AGENT_KEY) {
    return res.status(403).json({ error: "caller is not the allow-listed front door" });
  }
  next();
}

// consentId -> { userId, sessionId, patch, createdAt }
const pendingConsents = new Map();

app.get("/healthz", (_req, res) => res.json({ status: "ok", agentId: AGENT_ID }));

app.post("/agent/chat", requireFrontdoor, async (req, res) => {
  const { userId, sessionId, message, correlationId } = req.body || {};
  if (!userId || !message) {
    return res.status(400).json({ error: "userId and message are required" });
  }

  try {
    const plan = await planTurn({ message, userId, correlationId });

    if (plan.type === "consent_required") {
      const consentId = crypto.randomUUID();
      pendingConsents.set(consentId, {
        userId,
        sessionId,
        patch: plan.args.patch,
        createdAt: Date.now(),
      });
      return res.json({
        type: "consent_required",
        consentId,
        tool: plan.tool,
        proposedPatch: plan.args.patch,
        message: plan.askText,
      });
    }

    return res.json({ type: "final", message: plan.text });
  } catch (err) {
    return res.status(502).json({ error: `agent turn failed: ${err.message}` });
  }
});

app.post("/agent/consent-callback", requireFrontdoor, async (req, res) => {
  const { consentId, approved, oboToken, correlationId } = req.body || {};
  const pending = pendingConsents.get(consentId);
  if (!pending) {
    return res.status(404).json({ error: "unknown or already-resolved consentId" });
  }
  pendingConsents.delete(consentId);

  try {
    const result = await completeAfterConsent({
      approved,
      oboToken,
      userId: pending.userId,
      patch: pending.patch,
      correlationId,
    });
    return res.json({ type: "final", message: result.text });
  } catch (err) {
    return res.status(502).json({ error: `consent completion failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`agent-service (${AGENT_ID}) listening on :${PORT}`);
});
