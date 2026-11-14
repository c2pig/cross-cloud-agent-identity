# Application Auth0 objects for the Gemini agent POC.
# The tenant contract (domain, issuer, JWKS, default audience) stays in
# managed-infrastructure stacks/global/auth0/platform. Do not add tenant
# settings, users, the Default App, or the ROPG spike client here.

resource "auth0_resource_server" "api" {
  name        = "Gemini Agent POC API"
  identifier  = var.auth0_audience
  signing_alg = "RS256"

  # Access tokens are short-lived; the consent OBO token is 60s as well.
  token_lifetime                                  = 60
  skip_consent_for_verifiable_first_party_clients = true
}

resource "auth0_resource_server_scopes" "api" {
  resource_server_identifier = auth0_resource_server.api.identifier

  scopes {
    name        = "preference:write"
    description = "Update the signed-in user's saved search preference after explicit consent."
  }
}

resource "auth0_client" "spa" {
  name            = "Gemini Agent POC"
  app_type        = "spa"
  oidc_conformant = true
  is_first_party  = true
  grant_types     = ["authorization_code", "refresh_token"]

  callbacks           = var.frontend_urls
  allowed_logout_urls = var.frontend_urls
  web_origins         = var.frontend_urls
  allowed_origins     = var.frontend_urls

  jwt_configuration {
    alg = "RS256"
  }

  refresh_token {
    rotation_type                = "rotating"
    expiration_type              = "expiring"
    leeway                       = 0
    token_lifetime               = 2592000
    infinite_idle_token_lifetime = false
    infinite_token_lifetime      = false
    idle_token_lifetime          = 1296000
  }
}

resource "auth0_client_grant" "spa" {
  client_id = auth0_client.spa.id
  audience  = auth0_resource_server.api.identifier
  scopes    = ["preference:write"]
}
