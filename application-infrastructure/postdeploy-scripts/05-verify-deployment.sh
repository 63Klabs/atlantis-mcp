#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[05-verify-deployment]"

# Paths are relative to the repository root, like scripts 01 to 04
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${SCRIPT_DIR}/verify-deployment.js"
ENV_FILE="build/staging/api-spec/env.sh"
RELEASE_VERSION_SCRIPT="application-infrastructure/build-scripts/write_release_version.py"
RELEASE_VERSION_FILE="application-infrastructure/src/lambda/read-function/config/release-version.js"
SETTINGS_FILE="application-infrastructure/src/static/settings.json"
SKIP_PARAM_SUFFIX="Mcp_PostDeployTestVerifySkip"
KEY_PARAM_SUFFIX="Mcp_PostDeployTestVerifyApiKey"
# Must match EXIT_CODES.SKIP_CHECK_SKIPPED in verify-deployment.js (a test checks this)
SKIP_CHECK_SKIPPED=20

# The Verifier owns the WARN and ERROR lines; the Wrapper only logs INFO
log_info() { echo "${LOG_PREFIX} INFO: $*"; }

# Read one SSM SecureString into ssm_value, and the read result into ssm_status:
# "ok", the AWS error code (for example ParameterNotFound), or "error".
# >! Never prints the value. Standard error goes to a temporary file so a CLI
# >! warning cannot end up inside the value; only the AWS error code is kept.
read_ssm_parameter() {
  local name="$1" err_file
  err_file="$(mktemp)"
  if ssm_value="$(aws ssm get-parameter --name "${name}" --with-decryption \
      --query 'Parameter.Value' --output text 2>"${err_file}")"; then
    ssm_status="ok"
  else
    ssm_value=""
    ssm_status="$(sed -n 's/.*An error occurred (\([A-Za-z0-9]*\)).*/\1/p' "${err_file}")"
    ssm_status="${ssm_status%%$'\n'*}"
    ssm_status="${ssm_status:-error}"
  fi
  # >! Remove the temporary file right away: exec at the end skips any EXIT trap
  rm -f "${err_file}"
}

add_config_error() { config_error="${config_error:+${config_error}; }$1"; }
# Read one Secrets Manager secret into secret_value, and the read result into secret_status:
# "ok", the AWS error code (for example AccessDeniedException), "empty", or "error".
# >! Never prints the value. Standard error goes to a temporary file so a CLI
# >! warning cannot end up inside the value; only the AWS error code is kept.
read_secret_string() {
  local secret_id="$1" err_file
  err_file="$(mktemp)"
  if secret_value="$(aws secretsmanager get-secret-value --secret-id "${secret_id}" \
      --query 'SecretString' --output text 2>"${err_file}")"; then
    secret_status="ok"
    # >! A secret with no string value prints as "None" with --output text; it is not a usable secret
    if [[ -z "${secret_value}" || "${secret_value}" == "None" ]]; then
      secret_value=""
      secret_status="empty"
    fi
  else
    secret_value=""
    secret_status="$(sed -n 's/.*An error occurred (\([A-Za-z0-9]*\)).*/\1/p' "${err_file}")"
    secret_status="${secret_status%%$'\n'*}"
    secret_status="${secret_status:-error}"
  fi
  # >! Remove the temporary file right away: exec at the end skips any EXIT trap
  rm -f "${err_file}"
}
# Learn whether the stage protects its API with the origin secret (Requirements 7.3 and 7.4).
# Sets origin_protection ("true" or "false") and, when it is "true", origin_secret. A problem is
# added to config_error, so the Verifier reports it and the run fails; it never falls back to
# sending no header, which would test nothing.
read_origin_protection() {
  local stack_name="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application"
  local secret_name="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-OriginSecret"
  local flag
  if ! flag="$(aws cloudformation describe-stacks --stack-name "${stack_name}" \
      --query "Stacks[0].Parameters[?ParameterKey=='ApiIsBehindCloudFront'].ParameterValue" \
      --output text 2>/dev/null)"; then
    add_config_error "could not read the ApiIsBehindCloudFront parameter of stack ${stack_name}; the PostDeploy role needs cloudformation:DescribeStacks on it. Fix it and retry the PostDeploy stage"
    return 0
  fi
  flag="${flag//[[:space:]]/}"
  case "${flag}" in
    true) ;;
    # An older stack has no such parameter: protection is off
    false|None|"") return 0 ;;
    *)
      add_config_error "the ApiIsBehindCloudFront parameter of stack ${stack_name} is neither true nor false"
      return 0
      ;;
  esac
  origin_protection="true"
  read_secret_string "${secret_name}"
  if [[ "${secret_status}" != "ok" ]]; then
    secret_value=""
    add_config_error "origin protection is on (ApiIsBehindCloudFront is true) but the origin secret ${secret_name} could not be read (${secret_status}); grant secretsmanager:GetSecretValue on it to the PostDeploy role through PostDeploySvcRoleIncludeManagedPolicyArns on the pipeline stack, then retry the PostDeploy stage"
    return 0
  fi
  origin_secret="${secret_value}"
  secret_value=""
}

# 1. Skip switch, before any other input is gathered (Requirement 12.3)
skip_status="hierarchy-unset"
skip_value=""
if [[ -n "${PARAM_STORE_HIERARCHY:-}" ]]; then
  read_ssm_parameter "${PARAM_STORE_HIERARCHY}${SKIP_PARAM_SUFFIX}"
  skip_status="${ssm_status}"
  skip_value="${ssm_value}"
fi
skip_rc=0
VERIFY_SKIP_SSM_STATUS="${skip_status}" VERIFY_SKIP_SSM_VALUE="${skip_value}" \
  node "${VERIFIER}" skip-check || skip_rc=$?
if [[ "${skip_rc}" -eq "${SKIP_CHECK_SKIPPED}" ]]; then
  exit 0
elif [[ "${skip_rc}" -ne 0 ]]; then
  exit "${skip_rc}"
fi

# 2. Required inputs; problems are collected, not fatal, so the Verifier reports them
config_error=""
for var_name in PREFIX PROJECT_ID STAGE_ID AWS_REGION PARAM_STORE_HIERARCHY; do
  [[ -n "${!var_name:-}" ]] || add_config_error "${var_name} is not set"
done
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi
if [[ -z "${REST_API_ID:-}" || -z "${API_STAGE_NAME:-}" ]]; then
  add_config_error "${ENV_FILE} is missing or does not set REST_API_ID and API_STAGE_NAME"
fi

# 3. Expected version, from the same script the main build runs.
# Progress output is discarded; only standard error is kept for the message.
expected_version=""
if py_err="$(python3 "${RELEASE_VERSION_SCRIPT}" 2>&1 >/dev/null)"; then
  expected_version="$(node "${VERIFIER}" release-version "${RELEASE_VERSION_FILE}")" \
    || add_config_error "no release version in ${RELEASE_VERSION_FILE}"
else
  add_config_error "write_release_version.py failed: ${py_err//$'\n'/ }"
fi

# 4. Targets
raw_url=""
if [[ -n "${REST_API_ID:-}" && -n "${API_STAGE_NAME:-}" && -n "${AWS_REGION:-}" ]]; then
  raw_url="https://${REST_API_ID}.execute-api.${AWS_REGION}.amazonaws.com/${API_STAGE_NAME}/mcp/v1"
fi
edge_url=""
if [[ -n "${STAGE_ID:-}" ]]; then
  edge_url="$(node "${VERIFIER}" edge-url "${SETTINGS_FILE}" "${STAGE_ID}")" \
    || add_config_error "could not read the custom domain from ${SETTINGS_FILE}"
fi
# >! Origin protection is read only when the stack can be named; a missing variable is already a configuration error
origin_protection="false"
origin_secret=""
if [[ -n "${PREFIX:-}" && -n "${PROJECT_ID:-}" && -n "${STAGE_ID:-}" ]]; then
  read_origin_protection
fi
log_info "Raw target: ${raw_url:-unknown}"
log_info "Edge target: ${edge_url:-none (no custom domain for this stage)}"
log_info "Expected release version: ${expected_version:-unknown}"
# >! Only the flag is logged, never the secret
log_info "Origin protection: ${origin_protection}"

# 5. Verification key, read only when there is no configuration problem
key_value=""
key_status="none"
if [[ -z "${config_error}" ]]; then
  read_ssm_parameter "${PARAM_STORE_HIERARCHY}${KEY_PARAM_SUFFIX}"
  key_status="${ssm_status}"
  key_value="${ssm_value}"
fi

# 6. Run. >! The key reaches the Verifier only through its environment, never as an argument
MCP_URL="${raw_url}" MCP_EDGE_URL="${edge_url}" EXPECTED_VERSION="${expected_version}" \
  MCP_API_KEY="${key_value}" MCP_KEY_STATUS="${key_status}" \
  MCP_ORIGIN_PROTECTION="${origin_protection}" MCP_ORIGIN_SECRET="${origin_secret}" \
  VERIFY_SKIP_SSM_STATUS="${skip_status}" VERIFY_SKIP_SSM_VALUE="${skip_value}" \
  VERIFY_CONFIG_ERROR="${config_error}" \
  exec node "${VERIFIER}" run
