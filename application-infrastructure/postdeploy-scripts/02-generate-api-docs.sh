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

# Sanitize the OpenAPI spec to remove circular reference markers
# API Gateway exports can contain circular $ref chains. Redocly's bundler resolves
# them but leaves "x-circular-ref" marker properties set to null, which causes
# build-docs to crash with: TypeError: Cannot read properties of null (reading 'x-circular-ref')
# This step strips those markers so build-docs can render cleanly.
CLEAN_SPEC="build/staging/api-spec/openapi-clean.json"
echo "${LOG_PREFIX} INFO: Sanitizing OpenAPI spec (removing circular ref markers)..."
node -e "
  const fs = require('fs');
  const spec = JSON.parse(fs.readFileSync('${SPEC_FILE}', 'utf8'));
  function clean(obj) {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'x-circular-ref') continue;
        out[k] = clean(v);
      }
      return out;
    }
    return obj;
  }
  fs.writeFileSync('${CLEAN_SPEC}', JSON.stringify(clean(spec), null, 2));
" || {
  echo "${LOG_PREFIX} ERROR: Failed to sanitize OpenAPI spec at ${SPEC_FILE}" >&2
  exit 1
}

# Generate API documentation using Redoc CLI
echo "${LOG_PREFIX} INFO: Generating API documentation with Redoc CLI..."
npx @redocly/cli build-docs \
  "${CLEAN_SPEC}" \
  --output "${OUTPUT_DIR}/index.html" || {
  echo "${LOG_PREFIX} ERROR: Redoc CLI failed to generate documentation from ${CLEAN_SPEC}" >&2
  exit 1
}

# Validate the output HTML file exists and is non-empty
if [[ ! -s "${OUTPUT_DIR}/index.html" ]]; then
  echo "${LOG_PREFIX} ERROR: Generated API docs file is missing or empty at ${OUTPUT_DIR}/index.html" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: API documentation generated successfully at ${OUTPUT_DIR}/index.html"
