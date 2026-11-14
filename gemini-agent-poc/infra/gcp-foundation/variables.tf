variable "project_id" {
  type        = string
  description = "GCP project ID. Live POC: fresh-eyes-501103."
}

variable "region" {
  type        = string
  description = "Region for Artifact Registry."
  default     = "us-central1"
}
