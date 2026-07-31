import { mcp } from "./mcpClient.js";

const useGemini = Boolean(process.env.GEMINI_API_KEY);
const plannerPromise = useGemini ? import("./geminiClient.js") : import("./mockPlanner.js");

if (useGemini) {
  console.log("agent-service: using real Gemini function-calling planner");
} else {
  console.log("agent-service: GEMINI_API_KEY not set -- using mock planner (no external calls)");
}

export async function planTurn(args) {
  const planner = await plannerPromise;
  return planner.planTurn(args);
}

export async function completeAfterConsent({ approved, oboToken, userId, patch, correlationId }) {
  if (!approved) {
    return { text: "Okay, I won't make that change." };
  }
  const updated = await mcp.updatePreference(userId, patch, { oboToken, correlationId });
  return { text: `Done -- I've updated your saved preference: ${describeUpdated(updated)}` };
}

function describeUpdated(pref) {
  const { updatedAt, ...rest } = pref;
  return JSON.stringify(rest);
}
