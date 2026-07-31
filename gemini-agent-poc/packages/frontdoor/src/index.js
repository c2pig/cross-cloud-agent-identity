import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const { verifyAuth0Token, auth0Configured, mockAuthAllowed } = await import("./auth0.js");
const { mintOboToken } = await import("./obo.js");

// Cloud Run injects PORT at deploy time; FRONTDOOR_PORT is the local-dev knob.
const PORT = process.env.PORT || process.env.FRONTDOOR_PORT || 8080;
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8081";
const FRONTDOOR_TO_AGENT_KEY = process.env.FRONTDOOR_TO_AGENT_KEY;

if (!FRONTDOOR_TO_AGENT_KEY) {
  throw new Error("FRONTDOOR_TO_AGENT_KEY must be set (see .env.example)");
}

const app = express();
app.use(cors());
app.use(express.json());

function log(event, fields = {}) {
  // Structured logging. Never log the raw Auth0 token or OBO token here.
  console.log(JSON.stringify({ event, ...fields, timestamp: new Date().toISOString() }));
}

async function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (auth0Configured && token) {
    try {
      const claims = await verifyAuth0Token(token);
      req.user = { sub: claims.sub };
      return next();
    } catch (err) {
      log("auth_reject", { reason: err.message });
      return res.status(401).json({ error: "invalid token" });
    }
  }

  if (mockAuthAllowed) {
    const mockSub = req.headers["x-mock-user"];
    if (mockSub) {
      req.user = { sub: `mock|${mockSub}` };
      return next();
    }
  }

  return res.status(401).json({ error: "missing or invalid Authorization bearer token" });
}

// consentId -> { userId, sessionId } -- tracks who is allowed to resolve which
// pending consent request. The agent-service holds the actual proposed patch;
// this map exists purely so the front door can enforce "only the user who
// triggered this request may approve or deny it."
const pendingConsents = new Map();

app.get("/healthz", (_req, res) =>
  res.json({ status: "ok", auth0Configured, mockAuthAllowed })
);

app.post("/api/chat", requireUser, async (req, res) => {
  const { message, sessionId } = req.body || {};
  const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();
  const userId = req.user.sub;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const resp = await fetch(`${AGENT_SERVICE_URL}/agent/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frontdoor-Key": FRONTDOOR_TO_AGENT_KEY,
      },
      body: JSON.stringify({ userId, sessionId, message, correlationId }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || `agent-service returned ${resp.status}`);

    if (body.type === "consent_required") {
      pendingConsents.set(body.consentId, { userId, sessionId });
      log("chat_consent_required", {
        userId,
        correlationId,
        consentId: body.consentId,
        tool: body.tool,
      });
    } else {
      log("chat_success", { userId, correlationId });
    }

    res.json({ ...body, correlationId });
  } catch (err) {
    log("chat_failure", { userId, correlationId, error: err.message });
    res.status(502).json({ error: "agent call failed", correlationId });
  }
});

app.post("/api/consent/:consentId/:decision", requireUser, async (req, res) => {
  const { consentId, decision } = req.params;
  if (!["approve", "deny"].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approve' or 'deny'" });
  }

  const pending = pendingConsents.get(consentId);
  if (!pending) {
    return res.status(404).json({ error: "unknown or already-resolved consentId" });
  }
  if (pending.userId !== req.user.sub) {
    log("consent_mismatch", { consentId, callerSub: req.user.sub, expectedSub: pending.userId });
    return res.status(403).json({ error: "this consent request does not belong to the caller" });
  }
  pendingConsents.delete(consentId);

  const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();
  const approved = decision === "approve";

  // OBO tokens are only ever minted on explicit approval -- a denial produces
  // no delegated credential at all.
  const oboToken = approved
    ? mintOboToken({ userId: pending.userId, consentId, scope: "preference:write" })
    : null;

  try {
    const resp = await fetch(`${AGENT_SERVICE_URL}/agent/consent-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frontdoor-Key": FRONTDOOR_TO_AGENT_KEY,
      },
      body: JSON.stringify({ consentId, approved, oboToken, correlationId }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || `agent-service returned ${resp.status}`);

    log(approved ? "consent_approved" : "consent_denied", {
      userId: pending.userId,
      consentId,
      correlationId,
    });
    res.json({ ...body, correlationId });
  } catch (err) {
    log("consent_callback_failure", { consentId, correlationId, error: err.message });
    res.status(502).json({ error: "consent callback failed", correlationId });
  }
});

app.listen(PORT, () => {
  console.log(
    `frontdoor listening on :${PORT} (auth0Configured=${auth0Configured}, mockAuthAllowed=${mockAuthAllowed})`
  );
});
