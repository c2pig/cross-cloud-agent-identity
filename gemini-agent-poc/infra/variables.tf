variable "project_id" {
  description = "GCP project ID to deploy the POC into."
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run services and Artifact Registry."
  type        = string
  default     = "us-central1"
}

variable "image_tag" {
  description = "Container image tag applied to all four services (e.g. a git SHA)."
  type        = string
  default     = "latest"
}

variable "auth0_domain" {
  description = "Auth0 tenant domain, e.g. your-tenant.auth0.com."
  type        = string
}

variable "auth0_audience" {
  description = "Auth0 API identifier (audience) the SPA requests tokens for."
  type        = string
}

variable "gemini_api_key" {
  description = "Gemini API key. Leave empty to run agent-service in mock-planner mode."
  type        = string
  default     = ""
  sensitive   = true
}

variable "allow_unauthenticated_frontdoor" {
  description = "Whether the front door Cloud Run service accepts unauthenticated ingress (the Auth0 JWT check inside the app is the real gate, matching the POC's front-door pattern)."
  type        = bool
  default     = true
}

variable "enforce_cloud_run_iam_invoker" {
  description = <<-EOT
    When true, additionally locks mcp-server's invoker IAM to the agent-service
    service account, and agent-service's invoker IAM to the frontdoor service
    account -- a real GCP-level ingress allow-list, on top of this POC's
    app-level shared-secret checks.

    Left false by default because the app code currently carries its custom
    agent-identity / OBO tokens in the Authorization header. Cloud Run's own
    invoker check also inspects that header for a Google-signed ID token, so
    the two schemes collide -- flipping this on without first moving the
    app's custom tokens to a dedicated header (and having callers fetch a
    real Google ID token for Authorization) will make service-to-service
    calls fail with 403 at the platform layer. See docs/gcp-mapping.md.
  EOT
  type        = bool
  default     = false
}
