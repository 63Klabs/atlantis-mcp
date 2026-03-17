#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[02-generate-api-docs]"

# Staging directories
SPEC_FILE="build/staging/api-spec/openapi.json"
OUTPUT_DIR="build/staging/api-docs/docs/api"
OUTPUT_FILE="${OUTPUT_DIR}/index.html"

# Path to the resolver script (relative to repo root, where CodeBuild runs)
SCRIPT_DIR="application-infrastructure/postdeploy-scripts"
RESOLVER_SCRIPT="${SCRIPT_DIR}/resolve-and-render-spec.js"

# Verify the OpenAPI spec file exists
if [[ ! -f "${SPEC_FILE}" ]]; then
  echo "${LOG_PREFIX} ERROR: OpenAPI spec file not found at ${SPEC_FILE}" >&2
  exit 1
fi

# Verify the spec file is non-empty
if [[ ! -s "${SPEC_FILE}" ]]; then
  echo "${LOG_PREFIX} ERROR: OpenAPI spec file is empty at ${SPEC_FILE}" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: Found OpenAPI spec at ${SPEC_FILE}"

# Create output directory
mkdir -p "${OUTPUT_DIR}"
echo "${LOG_PREFIX} INFO: Created output directory ${OUTPUT_DIR}"

# Generate API documentation HTML by resolving all $ref pointers (breaking
# circular chains) and embedding the spec inline with Redoc loaded from CDN.
echo "${LOG_PREFIX} INFO: Resolving refs and generating API documentation HTML..."
node "${RESOLVER_SCRIPT}" "${SPEC_FILE}" "${OUTPUT_FILE}" || {
  echo "${LOG_PREFIX} ERROR: Failed to generate API documentation HTML" >&2
  exit 1
}

# Validate the output HTML file exists and is non-empty
if [[ ! -s "${OUTPUT_FILE}" ]]; then
  echo "${LOG_PREFIX} ERROR: Generated API docs file is missing or empty at ${OUTPUT_FILE}" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: API documentation generated successfully at ${OUTPUT_FILE}"
