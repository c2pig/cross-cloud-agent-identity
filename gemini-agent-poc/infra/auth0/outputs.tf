output "spa_client_id" {
  description = "SPA client ID for VITE_AUTH0_CLIENT_ID."
  value       = auth0_client.spa.client_id
}

output "api_audience" {
  description = "API identifier. Must match the platform default_api_audience."
  value       = auth0_resource_server.api.identifier
}
