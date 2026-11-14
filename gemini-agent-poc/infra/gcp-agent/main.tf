# hashicorp/google and hashicorp/google-beta 6.x do not expose a reasoning
# engine resource, an Agent Identity field, or an Agent Gateway resource
# (checked against the provider schema at authoring time). Those objects stay
# in packages/agent-runtime/deploy.py and the gateway YAML files. This stack
# only manages the supporting resources the provider does have.
#
# Gateways stay unattached. Attaching the egress gateway on the managed
# runtime crashes the agent with CERTIFICATE_VERIFY_FAILED. There is no
# attach_gateways flag here because there is no gateway resource to attach.

resource "google_storage_bucket" "agent_engine_staging" {
  name                        = local.staging_bucket
  location                    = var.bucket_location
  uniform_bucket_level_access = true
  force_destroy               = false

  labels = {
    managed-by = "terraform"
    service    = "gemini-agent-poc"
  }
}

resource "google_project_iam_member" "bridge_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.expressUser"
  member  = "serviceAccount:${local.agent_sa}"
}
