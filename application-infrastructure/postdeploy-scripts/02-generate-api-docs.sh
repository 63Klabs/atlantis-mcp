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

# Generate a self-contained HTML page that embeds the OpenAPI spec inline and
# loads Redoc from CDN at runtime. This avoids the SSR prerendering step in
# "redocly build-docs" which crashes on API Gateway specs containing circular
# $ref chains (TypeError: Cannot read properties of null reading 'x-circular-ref').
# The client-side Redoc renderer handles circular refs without issue.
echo "${LOG_PREFIX} INFO: Generating API documentation HTML with embedded spec..."
node -e "
  const fs = require('fs');
  const specJson = fs.readFileSync('${SPEC_FILE}', 'utf8');

  // Extract title from spec for the page heading
  let title = 'API Reference';
  try {
    const spec = JSON.parse(specJson);
    if (spec.info && spec.info.title) title = spec.info.title;
  } catch (e) { /* use default */ }

  const html = \`<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>\${title}</title>
  <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
  <div id=\"redoc-container\"></div>
  <script src=\"https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js\"></script>
  <script>
    var spec = \${specJson};
    Redoc.init(spec, {
      scrollYOffset: 0,
      hideDownloadButton: false
    }, document.getElementById('redoc-container'));
  </script>
</body>
</html>\`;

  fs.writeFileSync('${OUTPUT_DIR}/index.html', html);
" || {
  echo "${LOG_PREFIX} ERROR: Failed to generate API documentation HTML" >&2
  exit 1
}

# Validate the output HTML file exists and is non-empty
if [[ ! -s "${OUTPUT_DIR}/index.html" ]]; then
  echo "${LOG_PREFIX} ERROR: Generated API docs file is missing or empty at ${OUTPUT_DIR}/index.html" >&2
  exit 1
fi

echo "${LOG_PREFIX} INFO: API documentation generated successfully at ${OUTPUT_DIR}/index.html"
