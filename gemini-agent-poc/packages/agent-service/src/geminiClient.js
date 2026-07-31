// Real Gemini function-calling planner, used when GEMINI_API_KEY is set.
// Same planTurn() interface as mockPlanner.js so agentEngine.js can swap
// between them with no other code changes.
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { mcp } from "./mcpClient.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const tools = [
  {
    functionDeclarations: [
      {
        name: "search_property",
        description:
          "Search mock property listings by city, max price, minimum bedrooms, and property type.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            city: { type: SchemaType.STRING },
            maxPrice: { type: SchemaType.NUMBER },
            minBedrooms: { type: SchemaType.NUMBER },
            type: { type: SchemaType.STRING, enum: ["condo", "house", "townhouse"] },
          },
        },
      },
      {
        name: "get_preference",
        description: "Read the current user's saved search preference.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "update_preference",
        description:
          "Propose updating the current user's saved search preference. This is a sensitive write and always requires the user's explicit consent before being applied -- calling this function only proposes the change, it does not save it.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            city: { type: SchemaType.STRING },
            maxPrice: { type: SchemaType.NUMBER },
            minBedrooms: { type: SchemaType.NUMBER },
            type: { type: SchemaType.STRING, enum: ["condo", "house", "townhouse"] },
          },
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION =
  "You are a real-estate concierge agent. Use search_property and get_preference freely to help the user. " +
  "Never assume it is safe to persist a preference change yourself -- always call update_preference to propose " +
  "the change and let the platform obtain the user's consent before it is saved.";

export async function planTurn({ message, userId, history = [], correlationId }) {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    tools,
    systemInstruction: SYSTEM_INSTRUCTION,
  });
  const chat = model.startChat({ history });

  let result = await chat.sendMessage(message);

  for (let i = 0; i < 4; i += 1) {
    const call = result.response.functionCalls?.()?.[0];
    if (!call) break;

    if (call.name === "update_preference") {
      return {
        type: "consent_required",
        tool: "update_preference",
        args: { patch: call.args },
        askText: `I'd like to update your saved preference to ${JSON.stringify(call.args)}. Shall I go ahead?`,
      };
    }

    let toolResult;
    try {
      if (call.name === "search_property") {
        toolResult = await mcp.searchProperty(call.args, { correlationId });
      } else if (call.name === "get_preference") {
        toolResult = await mcp.getPreference(userId, { correlationId });
      } else {
        toolResult = { error: "unknown tool" };
      }
    } catch (err) {
      toolResult = { error: err.message };
    }

    result = await chat.sendMessage([
      { functionResponse: { name: call.name, response: { result: toolResult } } },
    ]);
  }

  return { type: "final", text: result.response.text() };
}
