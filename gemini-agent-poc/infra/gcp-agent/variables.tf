variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "Region recorded for operators. The staging bucket itself uses var.bucket_location."
  default     = "us-central1"
}

variable "bucket_location" {
  type        = string
  description = "Location of the Agent Engine staging bucket."
  default     = "US"
}

variable "mcp_server_url" {
  type        = string
  description = "Cloud Run URL of gemini-poc-mcp-server, from infra/gcp-runtime output mcp_server_url. Consumed by packages/agent-runtime/deploy.py, not by a Terraform engine resource."
  default     = ""
}

locals {
  staging_bucket = "${var.project_id}-agent-engine-staging"
  agent_sa       = "gemini-poc-agent@${var.project_id}.iam.gserviceaccount.com"
}
