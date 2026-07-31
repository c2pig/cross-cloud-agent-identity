import jwt from "jsonwebtoken";

// Stands in for a token-exchange / downscoped-credential issuer (RFC 8693
// style "actor" delegation). In real GCP this would be a trust broker whose
// public verification key is discoverable, not a secret shared out-of-band
// with the MCP server.
const OBO_SIGNING_SECRET = process.env.OBO_SIGNING_SECRET;
const AGENT_IDENTITY_ID = process.env.AGENT_IDENTITY_ID || "agents/real-estate-agent-v1";

if (!OBO_SIGNING_SECRET) {
  throw new Error("OBO_SIGNING_SECRET must be set (see .env.example)");
}

export function mintOboToken({ userId, consentId, scope }) {
  return jwt.sign(
    {
      act: { sub: AGENT_IDENTITY_ID },
      scope,
      consent_id: consentId,
    },
    OBO_SIGNING_SECRET,
    {
      subject: userId,
      audience: "mcp-server",
      issuer: "frontdoor-broker-poc",
      expiresIn: "60s", // single-use, short-lived by design
    }
  );
}
