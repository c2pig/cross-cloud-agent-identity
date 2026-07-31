import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath =
  process.env.AGENT_REGISTRY_PATH || path.resolve(__dirname, "../registry/agents.json");

const registry = JSON.parse(readFileSync(registryPath, "utf-8"));

export function getAgentEntry(agentId) {
  return registry.agents.find((a) => a.id === agentId && a.status === "active") || null;
}

export function isToolAllowedForAgent(agentId, toolName) {
  const entry = getAgentEntry(agentId);
  if (!entry) return false;
  return entry.allowedTools.includes(toolName);
}

export function isScopeAllowedForAgent(agentId, scope) {
  const entry = getAgentEntry(agentId);
  if (!entry) return false;
  return entry.allowedScopes.includes(scope);
}

export function listRegistry() {
  return registry;
}
