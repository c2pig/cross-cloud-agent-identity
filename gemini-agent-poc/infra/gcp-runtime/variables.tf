variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "Cloud Run region."
  default     = "us-central1"
}

variable "image_tag" {
  type        = string
  description = "Container tag applied to mcp-server, bridge, frontdoor, and frontend."
  default     = "latest"
}

variable "auth0_domain" {
  type        = string
  description = "From managed-infrastructure stacks/global/auth0/platform output auth0_domain. This stack does not create Auth0 resources."
}

variable "auth0_audience" {
  type        = string
  description = "From managed-infrastructure stacks/global/auth0/platform output default_api_audience."
}

variable "reasoning_engine_id" {
  type        = string
  description = "Numeric Vertex AI reasoning engine ID the bridge calls. Live value is 2124909025014317056. deploy.py remains the create path until the provider can manage the engine."
}

variable "allow_unauthenticated_frontdoor" {
  type        = bool
  description = "Frontdoor accepts unauthenticated Cloud Run ingress. The Auth0 JWT check inside the app is the real gate."
  default     = true
}

variable "enforce_cloud_run_iam_invoker" {
  type        = bool
  description = <<-EOT
    When true, mcp-server invoker IAM is limited to the agent service account
    and the bridge invoker IAM is limited to the frontdoor service account.
    Left false because app-level tokens currently use the Authorization header,
    which collides with Cloud Run's own identity-token check. See docs/gcp-mapping.md.
  EOT
  default     = false
}

locals {
  repo_prefix          = "${var.region}-docker.pkg.dev/${var.project_id}/gemini-agent-poc"
  frontdoor_sa         = "gemini-poc-frontdoor@${var.project_id}.iam.gserviceaccount.com"
  agent_sa             = "gemini-poc-agent@${var.project_id}.iam.gserviceaccount.com"
  mcp_sa               = "gemini-poc-mcp-server@${var.project_id}.iam.gserviceaccount.com"
  obo_secret_id        = "gemini-poc-obo-signing-secret"
  frontdoor_key_secret = "gemini-poc-frontdoor-to-agent-key"
}
