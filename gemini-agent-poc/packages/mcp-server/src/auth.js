import jwt from "jsonwebtoken";

// -- Shared secret (POC only). Which *agent* is calling this MCP server is no
// longer verified here -- that's now enforced for real, before traffic ever
// reaches this container, by Agent Gateway (egress mode) checking the
// caller's mTLS-bound Agent Identity against Agent Registry's allow-list
// (see docs/gcp-mapping.md). What Agent Gateway does *not* model is
// per-action user consent, so this server still verifies that: the OBO
// token below stands in for a downscoped / token-exchange credential
// (RFC 8693 style) that in production would be issued by a trust broker
// whose signing key is published for verification, not shared out-of-band.
const OBO_SIGNING_SECRET = process.env.OBO_SIGNING_SECRET;

if (!OBO_SIGNING_SECRET) {
  throw new Error("OBO_SIGNING_SECRET must be set (see .env.example)");
}

// Single-use replay protection for OBO tokens, keyed by consent_id.
const consumedConsentIds = new Set();

export function verifyOboToken(oboToken, { requiredScope, expectedUserId }) {
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
  if (expectedUserId && claims.sub !== expectedUserId) {
    return { ok: false, reason: "OBO token subject does not match target user" };
  }

  return { ok: true, claims };
}

export function consumeConsentId(consentId) {
  consumedConsentIds.add(consentId);
}
