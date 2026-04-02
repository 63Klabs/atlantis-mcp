#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[01-export-api-spec]"

# >! Validate required environment variables before use
if [[ -z "${PREFIX:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: PREFIX environment variable is not set" >&2
  exit 1
fi

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: PROJECT_ID environment variable is not set" >&2
  exit 1
fi

if [[ -z "${STAGE_ID:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: STAGE_ID environment variable is not set" >&2
  exit 1
fi

# Staging directory for API spec output
STAGING_DIR="build/staging/api-spec"

# Derive the CloudFormation stack name from environment variables
STACK_NAME="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application"
echo "${LOG_PREFIX} INFO: Derived stack name: ${STACK_NAME}"

# Query CloudFormation for the WebApi physical resource ID
echo "${LOG_PREFIX} INFO: Querying CloudFormation for WebApi resource..."
REST_API_ID=$(aws cloudformation describe-stack-resource \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id "WebApi" \
  --query "StackResourceDetail.PhysicalResourceId" \
  --output text) || {
  echo "${LOG_PREFIX} ERROR: Failed to resolve WebApi resource from stack ${STACK_NAME}" >&2
  exit 1
}

if [[ -z "${REST_API_ID}" || "${REST_API_ID}" == "None" ]]; then
  echo "${LOG_PREFIX} ERROR: WebApi physical resource ID is empty for stack ${STACK_NAME}" >&2
  exit 1
fi
echo "${LOG_PREFIX} INFO: REST API ID: ${REST_API_ID}"

# Query CloudFormation for the ApiPathBase parameter value (stage name)
echo "${LOG_PREFIX} INFO: Querying CloudFormation for ApiPathBase parameter..."
API_STAGE_NAME=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Parameters[?ParameterKey=='ApiPathBase'].ParameterValue" \
  --output text) || {
  echo "${LOG_PREFIX} ERROR: Failed to query ApiPathBase parameter from stack ${STACK_NAME}" >&2
  exit 1
}

if [[ -z "${API_STAGE_NAME}" || "${API_STAGE_NAME}" == "None" ]]; then
  echo "${LOG_PREFIX} ERROR: ApiPathBase parameter not found in stack ${STACK_NAME}" >&2
  exit 1
fi
echo "${LOG_PREFIX} INFO: API stage name: ${API_STAGE_NAME}"

# Create staging directory
mkdir -p "${STAGING_DIR}"

# Export the OpenAPI 3.0 specification
echo "${LOG_PREFIX} INFO: Exporting OpenAPI 3.0 spec for REST API ${REST_API_ID}, stage ${API_STAGE_NAME}..."
aws apigateway get-export \
  --rest-api-id "${REST_API_ID}" \
  --stage-name "${API_STAGE_NAME}" \
  --export-type oas30 \
  --accepts "application/json" \
  "${STAGING_DIR}/openapi.json" || {
  echo "${LOG_PREFIX} ERROR: Failed to export OpenAPI spec for REST API ${REST_API_ID}, stage ${API_STAGE_NAME}" >&2
  exit 1
}

# Validate the exported file exists and is non-empty
if [[ ! -s "${STAGING_DIR}/openapi.json" ]]; then
  echo "${LOG_PREFIX} ERROR: Exported OpenAPI spec is missing or empty at ${STAGING_DIR}/openapi.json" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: OpenAPI spec exported successfully to ${STAGING_DIR}/openapi.json"

# Write environment variables for downstream scripts (script 04 sources this file)
ENV_FILE="${STAGING_DIR}/env.sh"
echo "export REST_API_ID=\"${REST_API_ID}\"" > "${ENV_FILE}"
echo "export API_STAGE_NAME=\"${API_STAGE_NAME}\"" >> "${ENV_FILE}"
echo "${LOG_PREFIX} INFO: Wrote REST_API_ID and API_STAGE_NAME to ${ENV_FILE}"
