import { FRONTDOOR_URL } from "./config";

export async function sendChat({ message, sessionId, authHeaders }) {
  const resp = await fetch(`${FRONTDOOR_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ message, sessionId }),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error || `chat failed with HTTP ${resp.status}`);
  return body;
}

export async function sendConsentDecision({ consentId, decision, authHeaders }) {
  const resp = await fetch(`${FRONTDOOR_URL}/api/consent/${consentId}/${decision}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error || `consent ${decision} failed with HTTP ${resp.status}`);
  return body;
}
