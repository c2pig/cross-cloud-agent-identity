import jwt from "jsonwebtoken";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:8082";
const AGENT_IDENTITY_ID = process.env.AGENT_IDENTITY_ID || "agents/real-estate-agent-v1";
const AGENT_IDENTITY_SIGNING_SECRET = process.env.AGENT_IDENTITY_SIGNING_SECRET;

if (!AGENT_IDENTITY_SIGNING_SECRET) {
  throw new Error("AGENT_IDENTITY_SIGNING_SECRET must be set (see .env.example)");
}

// Stands in for the automatic, short-lived ID token Vertex AI Agent Engine
// attaches to its principal identity. Minted fresh per call rather than
// cached, mirroring how short-lived tokens are meant to be used.
function mintAgentIdentityToken() {
  return jwt.sign({}, AGENT_IDENTITY_SIGNING_SECRET, {
    subject: AGENT_IDENTITY_ID,
    audience: "mcp-server",
    issuer: "gemini-agent-platform-poc",
    expiresIn: "5m",
  });
}

async function callTool(name, args, { oboToken, correlationId } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${mintAgentIdentityToken()}`,
  };
  if (oboToken) headers["X-Obo-Token"] = oboToken;

  const resp = await fetch(`${MCP_SERVER_URL}/mcp/tools/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, arguments: args, correlationId }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(body.error || `MCP call to ${name} failed with HTTP ${resp.status}`);
  }
  return body.result;
}

export const mcp = {
  searchProperty: (args, opts) => callTool("search_property", args, opts),
  getPreference: (userId, opts) => callTool("get_preference", { userId }, opts),
  updatePreference: (userId, patch, opts) =>
    callTool("update_preference", { userId, patch }, opts),
};

export const AGENT_ID = AGENT_IDENTITY_ID;
