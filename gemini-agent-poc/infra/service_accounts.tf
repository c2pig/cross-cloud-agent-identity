# One service account per component, mirroring the IAM checklist pattern from
# the cross-cloud-agent-identity POC: each hop gets its own narrowly-scoped
# identity rather than a shared one.

resource "google_service_account" "frontdoor" {
  account_id   = "gemini-poc-frontdoor"
  display_name = "Gemini Agent POC - front door"
}

resource "google_service_account" "agent_service" {
  account_id   = "gemini-poc-agent"
  display_name = "Gemini Agent POC - agent runtime"
}

resource "google_service_account" "mcp_server" {
  account_id   = "gemini-poc-mcp-server"
  display_name = "Gemini Agent POC - mock MCP server"
}
