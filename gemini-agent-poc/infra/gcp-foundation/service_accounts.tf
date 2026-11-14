# One service account per hop. gemini-poc-agent is the live account used by
# the Cloud Run bridge (the Node agent-service that originally used this
# account is retired).

resource "google_service_account" "frontdoor" {
  account_id   = "gemini-poc-frontdoor"
  display_name = "Gemini Agent POC - front door"
}

resource "google_service_account" "agent" {
  account_id   = "gemini-poc-agent"
  display_name = "Gemini Agent POC - agent bridge"
}

resource "google_service_account" "mcp_server" {
  account_id   = "gemini-poc-mcp-server"
  display_name = "Gemini Agent POC - MCP server"
}
