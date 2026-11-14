# Adopt the live SPA and API. The client-grant id is not in the platform
# inventory (it is a cgr_ id). If apply reports the grant already exists,
# import it with that id before re-applying. Do not import these objects
# into managed-infrastructure.

import {
  to = auth0_client.spa
  id = var.spa_client_id
}

import {
  to = auth0_resource_server.api
  id = var.auth0_audience
}

import {
  to = auth0_resource_server_scopes.api
  id = var.auth0_audience
}
