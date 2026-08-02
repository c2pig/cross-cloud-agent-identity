#!/bin/sh
# Installs the Agent Gateway (egress) TLS Inspection CA into the container's
# trust store. Runs during the managed Agent Runtime build, as root, via the
# platform's installation_scripts/ hook -- no custom Dockerfile needed.
#
# Two independent mechanisms, since we don't control (and can't fully verify)
# the base image's OS:
#   1. update-ca-certificates, if present (Debian/Ubuntu-style OS trust store)
#   2. A merged bundle built with Python + certifi, at a known path, that
#      httpx/requests/grpc can be pointed at via env vars regardless of (1).
CERT_SRC="./installation_scripts/gateway-ca-bundle.pem"
MERGED_BUNDLE="/usr/local/share/gateway-ca-bundle.pem"

echo "install-gateway-ca.sh: installing Agent Gateway CA..."

if [ ! -f "$CERT_SRC" ]; then
  echo "install-gateway-ca.sh: ERROR - $CERT_SRC not found" >&2
  exit 1
fi

if command -v update-ca-certificates >/dev/null 2>&1; then
  echo "install-gateway-ca.sh: update-ca-certificates found, installing via OS trust store"
  mkdir -p /usr/local/share/ca-certificates
  cp "$CERT_SRC" /usr/local/share/ca-certificates/agent-gateway.crt
  update-ca-certificates || echo "install-gateway-ca.sh: WARNING - update-ca-certificates failed, continuing"
else
  echo "install-gateway-ca.sh: update-ca-certificates not found, skipping OS trust store"
fi

echo "install-gateway-ca.sh: building merged bundle at $MERGED_BUNDLE (best effort)"
python3 -c "
import certifi
with open(certifi.where(), 'rb') as f:
    default_bundle = f.read()
with open('$CERT_SRC', 'rb') as f:
    gateway_cert = f.read()
with open('$MERGED_BUNDLE', 'wb') as f:
    f.write(default_bundle)
    f.write(b'\n')
    f.write(gateway_cert)
print('install-gateway-ca.sh: merged bundle written,', len(default_bundle) + len(gateway_cert), 'bytes')
" || echo "install-gateway-ca.sh: WARNING - python/certifi merge failed, continuing (OS trust store may still be updated)"

echo "install-gateway-ca.sh: done"
