#!/usr/bin/env bash
#
# Packages + deploys the dummy Lambda, creates an AWS AgentCore Gateway with
# Custom JWT (OAuth) inbound auth trusting Google-minted ID tokens, attaches
# the Lambda as a target, and enables CloudTrail data-event logging for
# bedrock-agentcore (off by default, required for the POC's audit checkpoint).
#
# NOTE: `aws bedrock-agentcore` is a newer surface and may drift between when
# this script was written and when it's run. If a subcommand below 404s or
# errors as unrecognized, check `aws bedrock-agentcore help` for the current
# subcommand names before assuming the architecture is wrong.
set -euo pipefail

: "${AWS_REGION:?set AWS_REGION}"
: "${LAMBDA_FUNCTION_NAME:?set LAMBDA_FUNCTION_NAME}"
: "${LAMBDA_EXECUTION_ROLE_ARN:?set LAMBDA_EXECUTION_ROLE_ARN}"
: "${GATEWAY_NAME:?set GATEWAY_NAME}"
: "${GATEWAY_SERVICE_ROLE_ARN:?set GATEWAY_SERVICE_ROLE_ARN}"
: "${GATEWAY_AUDIENCE:?set GATEWAY_AUDIENCE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="${SCRIPT_DIR}/../lambda"
BUILD_DIR="$(mktemp -d)"
ZIP_PATH="${BUILD_DIR}/lambda.zip"

echo "==> Packaging Lambda from ${LAMBDA_DIR}"
cp "${LAMBDA_DIR}/handler.py" "${BUILD_DIR}/"
(cd "${BUILD_DIR}" && zip -q lambda.zip handler.py)

echo "==> Deploying Lambda function ${LAMBDA_FUNCTION_NAME}"
if aws lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --zip-file "fileb://${ZIP_PATH}" \
    --region "${AWS_REGION}" >/dev/null
else
  aws lambda create-function \
    --function-name "${LAMBDA_FUNCTION_NAME}" \
    --runtime python3.12 \
    --role "${LAMBDA_EXECUTION_ROLE_ARN}" \
    --handler handler.handler \
    --zip-file "fileb://${ZIP_PATH}" \
    --region "${AWS_REGION}" >/dev/null
fi

LAMBDA_ARN=$(aws lambda get-function \
  --function-name "${LAMBDA_FUNCTION_NAME}" \
  --region "${AWS_REGION}" \
  --query 'Configuration.FunctionArn' --output text)
echo "Lambda ARN: ${LAMBDA_ARN}"

echo "==> Creating AgentCore Gateway ${GATEWAY_NAME} (Custom JWT inbound auth, trusts Google ID tokens)"
GATEWAY_JSON=$(aws bedrock-agentcore create-gateway \
  --name "${GATEWAY_NAME}" \
  --role-arn "${GATEWAY_SERVICE_ROLE_ARN}" \
  --protocol-type MCP \
  --authorizer-type CUSTOM_JWT \
  --authorizer-configuration "$(cat <<JSON
{
  "customJWTAuthorizer": {
    "discoveryUrl": "https://accounts.google.com/.well-known/openid-configuration",
    "allowedAudiences": ["${GATEWAY_AUDIENCE}"]
  }
}
JSON
)" \
  --region "${AWS_REGION}")

GATEWAY_ID=$(echo "${GATEWAY_JSON}" | jq -r '.gatewayId')
GATEWAY_URL=$(echo "${GATEWAY_JSON}" | jq -r '.gatewayUrl')
echo "Gateway ID: ${GATEWAY_ID}"
echo "Gateway MCP URL: ${GATEWAY_URL}"

echo "==> Attaching Lambda as a Gateway target"
aws bedrock-agentcore create-gateway-target \
  --gateway-identifier "${GATEWAY_ID}" \
  --name "hello-world-lambda" \
  --target-configuration "$(cat <<JSON
{
  "mcp": {
    "lambda": {
      "lambdaArn": "${LAMBDA_ARN}",
      "toolSchema": {
        "inlinePayload": [
          {
            "name": "hello_world_lambda",
            "description": "Returns a fixed hello-world response",
            "inputSchema": {"type": "object", "properties": {}}
          }
        ]
      }
    }
  }
}
JSON
)" \
  --region "${AWS_REGION}" >/dev/null

echo "==> Enabling CloudTrail data-event logging for bedrock-agentcore"
TRAIL_NAME="${CLOUDTRAIL_TRAIL_NAME:-poc-agentcore-trail}"
if ! aws cloudtrail get-trail --name "${TRAIL_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "    (!) Trail ${TRAIL_NAME} not found — create it first via 'aws cloudtrail create-trail', then re-run this script."
else
  aws cloudtrail put-event-selectors \
    --trail-name "${TRAIL_NAME}" \
    --advanced-event-selectors "$(cat <<JSON
[
  {
    "Name": "AgentCore data events",
    "FieldSelectors": [
      {"Field": "eventCategory", "Equals": ["Data"]},
      {"Field": "resources.type", "Equals": ["AWS::BedrockAgentCore::Gateway"]}
    ]
  }
]
JSON
)" \
    --region "${AWS_REGION}" >/dev/null
  echo "    CloudTrail data events enabled on trail ${TRAIL_NAME}"
fi

rm -rf "${BUILD_DIR}"

echo ""
echo "==> Done. Add to .env:"
echo "GATEWAY_MCP_URL=${GATEWAY_URL}"
