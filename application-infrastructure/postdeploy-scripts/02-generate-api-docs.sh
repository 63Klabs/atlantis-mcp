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

# Dereference the OpenAPI spec to resolve circular $ref entries
# API Gateway exports often contain circular references that cause Redocly build-docs to fail
# with "Cannot read properties of null (reading 'x-circular-ref')"
DEREFERENCED_SPEC="build/staging/api-spec/openapi-dereferenced.json"
echo "${LOG_PREFIX} INFO: Dereferencing OpenAPI spec to resolve circular references..."
npx @redocly/cli bundle \
  "${SPEC_FILE}" \
  --dereferenced \
  --output "${DEREFERENCED_SPEC}" || {
  echo "${LOG_PREFIX} ERROR: Failed to dereference OpenAPI spec at ${SPEC_FILE}" >&2
  exit 1
}

# Generate API documentation using Redoc CLI with the dereferenced spec
echo "${LOG_PREFIX} INFO: Generating API documentation with Redoc CLI..."
npx @redocly/cli build-docs \
  "${DEREFERENCED_SPEC}" \
  --output "${OUTPUT_DIR}/index.html" || {
  echo "${LOG_PREFIX} ERROR: Redoc CLI failed to generate documentation from ${DEREFERENCED_SPEC}" >&2
  exit 1
}

# Validate the output HTML file exists and is non-empty
if [[ ! -s "${OUTPUT_DIR}/index.html" ]]; then
  echo "${LOG_PREFIX} ERROR: Generated API docs file is missing or empty at ${OUTPUT_DIR}/index.html" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: API documentation generated successfully at ${OUTPUT_DIR}/index.html"
