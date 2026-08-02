# BYOC image for Vertex AI Agent Runtime. Build context is packages/agent-runtime/.
#
# The whole reason for BYOC over the managed deployment path: we own this
# Dockerfile, so installing Agent Gateway's egress TLS-inspection CA is a
# normal build step (see the docs' example) instead of an unverified hook.
FROM python:3.12-slim

WORKDIR /app

COPY byoc/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

ARG AGENT_GATEWAY_ROOT_CERTIFICATES
RUN if [ -n "$AGENT_GATEWAY_ROOT_CERTIFICATES" ]; then \
      echo "$AGENT_GATEWAY_ROOT_CERTIFICATES" > /usr/local/share/ca-certificates/agent-gateway.crt && \
      update-ca-certificates; \
    fi
ENV REQUESTS_CA_BUNDLE=${AGENT_GATEWAY_ROOT_CERTIFICATES:+/etc/ssl/certs/ca-certificates.crt}
ENV SSL_CERT_FILE=${AGENT_GATEWAY_ROOT_CERTIFICATES:+/etc/ssl/certs/ca-certificates.crt}
ENV GRPC_DEFAULT_SSL_ROOTS_FILE_PATH=${AGENT_GATEWAY_ROOT_CERTIFICATES:+/etc/ssl/certs/ca-certificates.crt}

COPY real_estate_agent/ ./real_estate_agent/
COPY byoc/main.py ./

ENV PORT=8080
EXPOSE 8080
CMD ["python", "main.py"]
