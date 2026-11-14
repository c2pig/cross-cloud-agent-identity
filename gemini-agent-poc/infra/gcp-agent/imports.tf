import {
  to = google_storage_bucket.agent_engine_staging
  id = "${var.project_id}-agent-engine-staging"
}

import {
  to = google_project_iam_member.bridge_vertex
  id = "${var.project_id} roles/aiplatform.expressUser serviceAccount:${local.agent_sa}"
}
