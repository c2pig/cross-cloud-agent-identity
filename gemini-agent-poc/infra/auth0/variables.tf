variable "auth0_domain" {
  type        = string
  description = "Auth0 tenant domain. Published by managed-infrastructure stacks/global/auth0/platform (auth0_domain). This stack does not create or change the tenant."

  validation {
    condition     = !strcontains(var.auth0_domain, "://") && length(var.auth0_domain) > 0
    error_message = "auth0_domain must be a hostname, not a URL."
  }
}

variable "auth0_audience" {
  type        = string
  description = "API identifier. Published by managed-infrastructure as default_api_audience. This stack creates that API in the application state, not in the platform state."
}

variable "terraform_client_id" {
  type        = string
  description = "Client ID of the Gemini Agent POC Terraform M2M application. Set from AUTH0_CLIENT_ID or a tfvars file that is not committed."
}

variable "terraform_client_secret" {
  type        = string
  sensitive   = true
  description = "Client secret for the Terraform M2M application. Never commit this value."
}

variable "spa_client_id" {
  type        = string
  description = "Existing SPA client ID to adopt. Live inventory: Gemini Agent POC."
  default     = "PQR8JYTZrZJIIhi7HVdziEk4ipvTxIw1"
}

variable "frontend_urls" {
  type        = list(string)
  description = "SPA callback, logout, and web-origin URLs."
  default = [
    "http://localhost:5173",
    "https://gemini-poc-frontend-3jr65s33wq-uc.a.run.app",
  ]
}
