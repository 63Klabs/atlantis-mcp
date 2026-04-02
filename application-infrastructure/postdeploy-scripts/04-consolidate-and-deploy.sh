#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[04-consolidate-and-deploy]"

# >! Validate required environment variables before use
if [[ -z "${S3_STATIC_HOST_BUCKET:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: S3_STATIC_HOST_BUCKET environment variable is not set" >&2
  exit 1
fi

if [[ -z "${STAGE_ID:-}" ]]; then
  echo "${LOG_PREFIX} ERROR: STAGE_ID environment variable is not set" >&2
  exit 1
fi

# Directories
FINAL_DIR="build/final"
STAGING_DIR="build/staging"
PUBLIC_DIR="application-infrastructure/src/static/public"
S3_DESTINATION="s3://${S3_STATIC_HOST_BUCKET}/${STAGE_ID}/public/"

echo "${LOG_PREFIX} INFO: Starting consolidation and deployment"
echo "${LOG_PREFIX} INFO: S3 destination: ${S3_DESTINATION}"

# Remove build/final/ if it exists from a previous run
if [[ -d "${FINAL_DIR}" ]]; then
  rm -rf "${FINAL_DIR}"
  echo "${LOG_PREFIX} INFO: Removed existing ${FINAL_DIR}"
fi

# Create build/final/
mkdir -p "${FINAL_DIR}"
echo "${LOG_PREFIX} INFO: Created ${FINAL_DIR}"

# Copy contents from each staging directory into build/final/ preserving structure
# api-docs staging contains docs/api/
if [[ -d "${STAGING_DIR}/api-docs" ]]; then
  cp -r "${STAGING_DIR}/api-docs/." "${FINAL_DIR}/"
  echo "${LOG_PREFIX} INFO: Copied api-docs staging contents"
fi

# markdown-docs staging contains docs/<dir>/ and docs/css/
if [[ -d "${STAGING_DIR}/markdown-docs" ]]; then
  cp -r "${STAGING_DIR}/markdown-docs/." "${FINAL_DIR}/"
  echo "${LOG_PREFIX} INFO: Copied markdown-docs staging contents"
fi

# Copy static public assets (landing page) to build/final/ root
if [[ -d "${PUBLIC_DIR}" ]]; then
  cp -r "${PUBLIC_DIR}/." "${FINAL_DIR}/"
  echo "${LOG_PREFIX} INFO: Copied static public assets from ${PUBLIC_DIR}"
else
  echo "${LOG_PREFIX} WARN: Public directory not found at ${PUBLIC_DIR}"
fi

# Copy exported OpenAPI spec to build/final/ for download
if [[ -f "${STAGING_DIR}/api-spec/openapi.json" ]]; then
  mkdir -p "${FINAL_DIR}/docs/api"
  cp "${STAGING_DIR}/api-spec/openapi.json" "${FINAL_DIR}/docs/api/openapi.json"
  echo "${LOG_PREFIX} INFO: Copied openapi.json to ${FINAL_DIR}/docs/api/openapi.json"
else
  echo "${LOG_PREFIX} WARN: OpenAPI spec not found at ${STAGING_DIR}/api-spec/openapi.json"
fi

# Source API Gateway environment variables from script 01 output
ENV_FILE="${STAGING_DIR}/api-spec/env.sh"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  echo "${LOG_PREFIX} INFO: Sourced ${ENV_FILE} (REST_API_ID=${REST_API_ID:-unset}, API_STAGE_NAME=${API_STAGE_NAME:-unset})"
else
  echo "${LOG_PREFIX} WARN: ${ENV_FILE} not found — skipping API Gateway URL replacement"
fi

# Apply settings token replacement across all consolidated content
SETTINGS_FILE="application-infrastructure/src/static/settings.json"
APPLY_SETTINGS_SCRIPT="application-infrastructure/postdeploy-scripts/apply-settings.js"

APPLY_SETTINGS_ARGS=("${SETTINGS_FILE}" "${FINAL_DIR}" "${STAGE_ID}")
if [[ -n "${REST_API_ID:-}" && -n "${AWS_REGION:-}" && -n "${API_STAGE_NAME:-}" ]]; then
  APPLY_SETTINGS_ARGS+=(--rest-api-id "${REST_API_ID}" --region "${AWS_REGION}" --api-stage-name "${API_STAGE_NAME}")
fi

echo "${LOG_PREFIX} INFO: Running apply-settings.js..."
node "${APPLY_SETTINGS_SCRIPT}" "${APPLY_SETTINGS_ARGS[@]}" || {
  echo "${LOG_PREFIX} ERROR: apply-settings.js failed" >&2
  exit 1
}
echo "${LOG_PREFIX} INFO: Settings applied successfully"

# Count files for logging
file_count=$(find "${FINAL_DIR}" -type f | wc -l)
echo "${LOG_PREFIX} INFO: Final build directory contains ${file_count} file(s)"

# >! Sync to S3 with --delete to remove stale files
echo "${LOG_PREFIX} INFO: Syncing ${FINAL_DIR} to ${S3_DESTINATION}"
aws s3 sync "${FINAL_DIR}" "${S3_DESTINATION}" --delete || {
  echo "${LOG_PREFIX} ERROR: Failed to sync to ${S3_DESTINATION}" >&2
  exit 1
}

echo "${LOG_PREFIX} INFO: Deployment complete. ${file_count} file(s) synced to ${S3_DESTINATION}"
