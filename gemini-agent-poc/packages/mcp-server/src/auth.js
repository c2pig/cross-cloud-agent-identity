import jwt from "jsonwebtoken";

// -- Shared secrets (POC only). In real GCP:
//    - the "agent identity" token below stands in for the ID token Vertex AI
//      Agent Engine automatically attaches to its principal
//      (principal://.../reasoningEngines/{id}), which this server would
//      verify against Google's public JWKS rather than a shared secret.
//    - the "OBO" (on-behalf-of) token stands in for a downscoped / token-exchange
//      credential (RFC 8693 style), which in production would be issued by a
//      trust broker whose signing key is published for verification, not shared
//      out-of-band.
const AGENT_IDENTITY_SIGNING_SECRET = process.env.AGENT_IDENTITY_SIGNING_SECRET;
const OBO_SIGNING_SECRET = process.env.OBO_SIGNING_SECRET;

if (!AGENT_IDENTITY_SIGNING_SECRET || !OBO_SIGNING_SECRET) {
  throw new Error(
    "AGENT_IDENTITY_SIGNING_SECRET and OBO_SIGNING_SECRET must be set (see .env.example)"
  );
}

// Single-use replay protection for OBO tokens, keyed by consent_id.
const consumedConsentIds = new Set();

export function verifyAgentIdentityToken(bearerToken) {
  if (!bearerToken) return { ok: false, reason: "missing agent identity token" };
  try {
    const claims = jwt.verify(bearerToken, AGENT_IDENTITY_SIGNING_SECRET, {
      audience: "mcp-server",
    });
    return { ok: true, agentId: claims.sub, claims };
  } catch (err) {
    return { ok: false, reason: `invalid agent identity token: ${err.message}` };
  }
}

export function verifyOboToken(oboToken, { requiredScope, expectedAgentId, expectedUserId }) {
  if (!oboToken) return { ok: false, reason: "missing on-behalf-of token" };
  let claims;
  try {
    claims = jwt.verify(oboToken, OBO_SIGNING_SECRET, { audience: "mcp-server" });
  } catch (err) {
    return { ok: false, reason: `invalid OBO token: ${err.message}` };
  }

  if (consumedConsentIds.has(claims.consent_id)) {
    return { ok: false, reason: "OBO token already used (replay rejected)" };
  }
  if (!claims.scope || !claims.scope.split(" ").includes(requiredScope)) {
    return { ok: false, reason: `OBO token missing required scope '${requiredScope}'` };
  }
  if (claims.act?.sub !== expectedAgentId) {
    return { ok: false, reason: "OBO token actor does not match calling agent identity" };
  }
  if (expectedUserId && claims.sub !== expectedUserId) {
    return { ok: false, reason: "OBO token subject does not match target user" };
  }

  return { ok: true, claims };
}

export function consumeConsentId(consentId) {
  consumedConsentIds.add(consentId);
}
