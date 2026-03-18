#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[03-generate-markdown-docs]"

# Staging directory for markdown docs output
STAGING_DIR="build/staging/markdown-docs"
# Temporary working directory for markdown processing
TMP_DIR="build/tmp/markdown"
# CSS source file for Pandoc HTML output
CSS_SOURCE="application-infrastructure/src/static/pandoc/style.css"

# >! Validate PUBLIC_DOC_DIRS is set (may be empty string intentionally)
if [[ -z "${PUBLIC_DOC_DIRS:-}" ]]; then
  echo "${LOG_PREFIX} WARN: PUBLIC_DOC_DIRS is not set or empty, no directories to process"
  exit 0
fi

echo "${LOG_PREFIX} INFO: Processing documentation directories: ${PUBLIC_DOC_DIRS}"


# >! Extract the first # Heading from a markdown file for the HTML title.
# >! Falls back to the filename (without extension) if no heading is found.
#
# @param $1 - Path to the markdown file
extract_title() {
  local md_file="$1"
  local title

  # >! Use grep to find the first level-1 heading, strip the leading '# '
  title=$(grep -m 1 '^# ' "${md_file}" | sed 's/^# //' || true)

  if [[ -z "${title}" ]]; then
    # Fall back to filename without extension
    title=$(basename "${md_file}" .md)
  fi

  echo "${title}"
}

# Track whether any directory was processed
has_processed=false

for dir in ${PUBLIC_DOC_DIRS}; do
  source_dir="docs/${dir}"

  # Check if the source directory exists
  if [[ ! -d "${source_dir}" ]]; then
    echo "${LOG_PREFIX} WARN: Directory does not exist: ${source_dir}, skipping"
    continue
  fi

  echo "${LOG_PREFIX} INFO: Processing directory: ${source_dir}"
  has_processed=true

  # Create temporary working directory
  tmp_work_dir="${TMP_DIR}/${dir}"
  mkdir -p "${tmp_work_dir}"

  # >! Copy source files to temp dir to avoid modifying the original docs/ structure
  cp -r "${source_dir}/." "${tmp_work_dir}/"

  # Create output directory
  output_dir="${STAGING_DIR}/docs/${dir}"
  mkdir -p "${output_dir}"

  # Convert each .md file to HTML
  find "${tmp_work_dir}" -name '*.md' -type f | while read -r md_file; do
    # Derive output filename
    base_name=$(basename "${md_file}" .md)
    html_name="${base_name}.html"

    # Extract title for the HTML document
    title=$(extract_title "${md_file}")

    # >! Strip the first H1 heading from the temp copy to avoid duplicate H1 in output.
    # >! Pandoc --standalone --metadata title= renders the title in a <header> block,
    # >! so the original # Heading in the body would create a second <h1>.
    sed -i '0,/^# /{/^# /d}' "${md_file}"

    echo "${LOG_PREFIX} INFO: Converting ${md_file} -> ${html_name} (title: ${title})"

    pandoc "${md_file}" \
      --standalone \
      --css="/docs/css/style.css" \
      --metadata title="${title}" \
      --to html5 \
      --output "${output_dir}/${html_name}" || {
      echo "${LOG_PREFIX} ERROR: Pandoc failed to convert ${md_file}" >&2
      # Clean up temp directories before exiting
      rm -rf "${TMP_DIR}"
      exit 1
    }
  done

  # Rename README.html to index.html if present
  if [[ -f "${output_dir}/README.html" ]]; then
    mv "${output_dir}/README.html" "${output_dir}/index.html"
    echo "${LOG_PREFIX} INFO: Renamed README.html to index.html in ${output_dir}"
  fi

  # >! Rewrite internal markdown links in generated HTML files so they resolve
  # >! correctly in the static site.  Two passes:
  # >!   1. README.md -> index.html  (directory index files)
  # >!   2. *.md      -> *.html      (all other markdown links)
  find "${output_dir}" -name '*.html' -type f | while read -r html_file; do
    sed -i \
      -e 's|href="\([^"]*\)README\.md|href="\1index.html|g' \
      -e "s|href='\([^']*\)README\.md|href='\1index.html|g" \
      -e 's|href="\([^"]*\)\.md"|href="\1.html"|g' \
      -e "s|href='\([^']*\)\.md'|href='\1.html'|g" \
      -e 's|href="\([^"]*\)\.md#|href="\1.html#|g' \
      -e "s|href='\([^']*\)\.md#|href='\1.html#|g" \
      "${html_file}"
  done
  echo "${LOG_PREFIX} INFO: Rewrote .md links to .html in ${output_dir}"
done

# Copy CSS stylesheet to staging directory so it is available at /docs/css/style.css
if [[ "${has_processed}" == true ]]; then
  css_output_dir="${STAGING_DIR}/docs/css"
  mkdir -p "${css_output_dir}"

  if [[ -f "${CSS_SOURCE}" ]]; then
    cp "${CSS_SOURCE}" "${css_output_dir}/style.css"
    echo "${LOG_PREFIX} INFO: Copied CSS stylesheet to ${css_output_dir}/style.css"
  else
    echo "${LOG_PREFIX} WARN: CSS source file not found at ${CSS_SOURCE}"
  fi
fi

# Clean up temporary working directories
if [[ -d "${TMP_DIR}" ]]; then
  rm -rf "${TMP_DIR}"
  echo "${LOG_PREFIX} INFO: Cleaned up temporary directory ${TMP_DIR}"
fi

echo "${LOG_PREFIX} INFO: Markdown documentation generation complete"
