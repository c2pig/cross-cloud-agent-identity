// In-memory audit log. In real GCP this maps to CloudTrail-style data-event
// logging for the MCP Gateway invocation, plus Cloud Logging / AgentCore
// Observability for the correlation_id join across clouds.

const log = [];

export function recordAudit(entry) {
  log.push({ timestamp: new Date().toISOString(), ...entry });
  // eslint-disable-next-line no-console
  console.log("[audit]", JSON.stringify(entry));
}

export function getAuditLog() {
  return log;
}
