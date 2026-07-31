// Deterministic stand-in for Gemini function-calling, used when GEMINI_API_KEY
// is not set so the full identity/delegation demo runs with zero external
// credentials. Swap in geminiClient.js (real Gemini + function calling) by
// setting GEMINI_API_KEY -- both modules implement the same planTurn() shape.
import { mcp } from "./mcpClient.js";
import { parseCriteria, describeCriteria } from "./criteria.js";

function detectIntent(message) {
  const m = message.toLowerCase();
  const wantsUpdate =
    /(update|change|save|set)\s+.*(prefer|budget|criteria)/.test(m) ||
    /prefer(s|red)?\s+(to|that|a)/.test(m) ||
    /from now on/.test(m);
  const wantsSearch =
    /(find|search|show me|look for|looking for|any (condo|house|townhouse)s?|properties|listings)/.test(
      m
    );
  if (wantsUpdate) return "update_preference";
  if (wantsSearch) return "search_property";
  return "chat";
}

export async function planTurn({ message, userId, correlationId }) {
  const intent = detectIntent(message);
  const criteria = parseCriteria(message);

  if (intent === "update_preference") {
    if (Object.keys(criteria).length === 0) {
      return {
        type: "final",
        text:
          "Sure -- tell me what you'd like to update (city, budget, bedrooms, or property type) and I'll confirm with you before saving it.",
      };
    }
    return {
      type: "consent_required",
      tool: "update_preference",
      args: { patch: criteria },
      askText: `I'd like to update your saved preference to ${describeCriteria(
        criteria
      )}. Shall I go ahead?`,
    };
  }

  if (intent === "search_property") {
    let saved = null;
    try {
      saved = await mcp.getPreference(userId, { correlationId });
    } catch {
      saved = null;
    }
    const merged = { ...(saved || {}), ...criteria };
    const results = await mcp.searchProperty(merged, { correlationId });

    if (results.length === 0) {
      return {
        type: "final",
        text: `I searched with ${describeCriteria(merged)} but didn't find a match. Want to widen the criteria?`,
      };
    }
    const lines = results
      .slice(0, 5)
      .map(
        (p) =>
          `- ${p.address}, ${p.city} — $${p.price.toLocaleString()}, ${p.bedrooms}bd/${p.bathrooms}ba ${p.type}`
      );
    return {
      type: "final",
      text: `Here's what I found${saved ? " (using your saved preference)" : ""}:\n${lines.join("\n")}`,
    };
  }

  return {
    type: "final",
    text:
      'I can search property listings or update your saved search preference -- try "find me a 2 bedroom condo in Austin under $400k" or "update my preference to Seattle townhouses under $500k".',
  };
}
