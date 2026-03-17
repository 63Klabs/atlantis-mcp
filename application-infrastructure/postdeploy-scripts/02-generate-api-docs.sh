#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[02-generate-api-docs]"

# Staging directories
SPEC_FILE="build/staging/api-spec/openapi.json"
OUTPUT_DIR="build/staging/api-docs/docs/api"

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

# Generate API documentation using Redoc CLI
echo "${LOG_PREFIX} INFO: Generating API documentation with Redoc CLI..."
npx @redocly/cli build-docs \
  "${SPEC_FILE}" \
  --output "${OUTPUT_DIR}/index.html" || {
  echo "${LOG_PREFIX} ERROR: Redoc CLI failed to generate documentation from ${SPEC_FILE}" >&2
  exit 1
}

# Validate the output HTML file exists and is non-empty
if [[ ! -s "${OUTPUT_DIR}/index.html" ]]; then
  echo "${LOG_PREFIX} ERROR: Generated API docs file is missing or empty at ${OUTPUT_DIR}/index.html" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: API documentation generated successfully at ${OUTPUT_DIR}/index.html"
