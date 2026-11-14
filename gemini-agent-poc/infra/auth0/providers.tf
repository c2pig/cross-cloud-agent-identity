provider "auth0" {
  domain        = var.auth0_domain
  client_id     = var.terraform_client_id
  client_secret = var.terraform_client_secret
}
