import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const { verifyAgentIdentityToken, verifyOboToken, consumeConsentId } = await import("./auth.js");
const { isToolAllowedForAgent, isScopeAllowedForAgent, listRegistry } = await import(
  "./registry.js"
);
const { searchProperties, getPreference, updatePreference } = await import("./data.js");
const { recordAudit, getAuditLog } = await import("./audit.js");

// Cloud Run injects PORT at deploy time; MCP_SERVER_PORT is the local-dev knob.
const PORT = process.env.PORT || process.env.MCP_SERVER_PORT || 8082;

const app = express();
app.use(cors());
app.use(express.json());

const TOOLS = [
  {
    name: "search_property",
    description: "Search mock property listings by city, price, bedrooms, and type.",
    requiresDelegation: false,
  },
  {
    name: "get_preference",
    description: "Read the calling user's saved search preference.",
    requiresDelegation: false,
  },
  {
    name: "update_preference",
    description: "Update the calling user's saved search preference. Requires user delegation (OBO token).",
    requiresDelegation: true,
    requiredScope: "preference:write",
  },
];

function bearerFrom(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

app.get("/mcp/tools/list", (_req, res) => {
  res.json({ tools: TOOLS.map(({ name, description }) => ({ name, description })) });
});

app.get("/admin/registry", (_req, res) => res.json(listRegistry()));
app.get("/admin/audit-log", (_req, res) => res.json(getAuditLog()));

app.post("/mcp/tools/call", (req, res) => {
  const { name, arguments: args = {}, correlationId } = req.body || {};
  const tool = TOOLS.find((t) => t.name === name);

  const agentToken = bearerFrom(req);
  const identity = verifyAgentIdentityToken(agentToken);

  const auditBase = { correlationId, tool: name, agentId: identity.agentId || null };

  if (!tool) {
    recordAudit({ ...auditBase, decision: "deny", reason: "unknown tool" });
    return res.status(404).json({ error: "unknown tool" });
  }

  if (!identity.ok) {
    recordAudit({ ...auditBase, decision: "deny", reason: identity.reason });
    return res.status(401).json({ error: identity.reason });
  }

  // Agent Registry check -- default-deny unless this agent+tool is explicitly registered.
  if (!isToolAllowedForAgent(identity.agentId, name)) {
    recordAudit({
      ...auditBase,
      decision: "deny",
      reason: "agent not registered for this tool (Agent Registry default-deny)",
    });
    return res.status(403).json({ error: "agent is not registered to call this tool" });
  }

  let onBehalfOf = null;

  if (tool.requiresDelegation) {
    if (!isScopeAllowedForAgent(identity.agentId, tool.requiredScope)) {
      recordAudit({
        ...auditBase,
        decision: "deny",
        reason: "agent not registered for required scope",
      });
      return res.status(403).json({ error: "agent is not registered for the required scope" });
    }

    const oboToken = req.headers["x-obo-token"];
    const obo = verifyOboToken(oboToken, {
      requiredScope: tool.requiredScope,
      expectedAgentId: identity.agentId,
      expectedUserId: args.userId,
    });

    if (!obo.ok) {
      recordAudit({ ...auditBase, decision: "deny", reason: obo.reason });
      return res.status(403).json({ error: obo.reason });
    }

    onBehalfOf = obo.claims.sub;
    consumeConsentId(obo.claims.consent_id);
  }

  let result;
  switch (name) {
    case "search_property":
      result = searchProperties(args);
      break;
    case "get_preference":
      result = getPreference(args.userId);
      break;
    case "update_preference":
      result = updatePreference(args.userId, args.patch || {});
      break;
    default:
      result = null;
  }

  recordAudit({
    ...auditBase,
    decision: "allow",
    onBehalfOf,
    consentId: tool.requiresDelegation ? req.body?.consentId : undefined,
  });

  res.json({ result });
});

app.listen(PORT, () => {
  console.log(`mock MCP server listening on :${PORT}`);
});
