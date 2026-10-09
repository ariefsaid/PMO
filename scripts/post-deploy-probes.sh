#!/usr/bin/env bash
# Run the post-deploy tenant probes in their required order. Inputs stay in the caller's environment.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { echo "Usage: scripts/post-deploy-probes.sh [--self-test] [--allow-skips]"; }
require_env() {
  local missing=() name
  for name in BASE ANON SMOKE_EMAIL SMOKE_PASSWORD SERVICE JWT_B A_ORG B_ORG A_ROWS_JSON; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'post-deploy-probes: required environment inputs missing: %s\n' "${missing[*]}" >&2
    return 2
  fi
  [ -r "$A_ROWS_JSON" ] || { echo "post-deploy-probes: A_ROWS_JSON must name a readable file" >&2; return 2; }
  [ "${RPC_ONLY:-}" != 1 ] || { echo "post-deploy-probes: inherited RPC_ONLY=1 is not allowed" >&2; return 2; }
  node "$SCRIPT_DIR/check-isolation-denominator.mjs" --validate-inputs || return $?
  ISOLATION_VALIDATE_ONLY=1 "$SCRIPT_DIR/isolation-probe.sh" || return $?
}
parse_summary() {
  local org=$1 roles=$2 isolation=$3
  local org_steps org_fails org_pass roles_steps roles_fails roles_pass checks leaks skipped probe_errors isolation_pass
  org_steps=$(printf '%s\n' "$org" | sed -nE 's/.*: ([0-9]+) steps,.*/\1/p' | tail -1)
  org_fails=$(printf '%s\n' "$org" | sed -nE 's/.* ([0-9]+) failed.*/\1/p' | tail -1)
  roles_steps=$(printf '%s\n' "$roles" | sed -nE 's/.*steps=([0-9]+).*/\1/p' | tail -1)
  roles_fails=$(printf '%s\n' "$roles" | sed -nE 's/.*fails=([0-9]+).*/\1/p' | tail -1)
  checks=$(printf '%s\n' "$isolation" | sed -nE 's/.*checks: ([0-9]+).*/\1/p' | tail -1)
  leaks=$(printf '%s\n' "$isolation" | sed -nE 's/.*leaks: ([0-9]+).*/\1/p' | tail -1)
  skipped=$(printf '%s\n' "$isolation" | sed -nE 's/.*skipped: ([0-9]+).*/\1/p' | tail -1)
  probe_errors=$(printf '%s\n' "$isolation" | sed -nE 's/.*probe_errors: ([0-9]+).*/\1/p' | tail -1)
  [ -n "$org_steps" ] && [ -n "$org_fails" ] && [ -n "$roles_steps" ] && [ -n "$roles_fails" ] && [ -n "$checks" ] && [ -n "$leaks" ] && [ -n "$skipped" ] && [ -n "$probe_errors" ] || {
    echo "post-deploy-probes: could not parse all probe summaries" >&2; return 1;
  }
  org_pass=$((org_steps - org_fails)); roles_pass=$((roles_steps - roles_fails)); isolation_pass=$((checks - leaks - probe_errors))
  printf 'post-deploy probes: org-smoke=%s passed/%s, %s failed; roles-smoke=%s passed/%s, %s failed; isolation=%s passed/%s, %s leaks, %s probe errors, %s skipped\n' \
    "$org_pass" "$org_steps" "$org_fails" "$roles_pass" "$roles_steps" "$roles_fails" "$isolation_pass" "$checks" "$leaks" "$probe_errors" "$skipped"
  [ "$org_fails" = 0 ] && [ "$roles_fails" = 0 ] && [ "$leaks" = 0 ] && [ "$probe_errors" = 0 ] && { [ "${ALLOW_SKIPS:-0}" = 1 ] || [ "$skipped" = 0 ]; }
}
isolation_exit_status() {
  local output=$1 status=$2 allow_skips=$3
  if [ "$status" -eq 4 ] || printf '%s\n' "$output" | grep -Eq 'probe_errors: [1-9]'; then printf 4; return 0; fi
  if [ "$status" -eq 1 ] || printf '%s\n' "$output" | grep -Eq 'leaks: [1-9]'; then printf 1; return 0; fi
  if [ "$allow_skips" != 1 ] && printf '%s\n' "$output" | grep -Eq 'skipped: [1-9]'; then printf 3; return 0; fi
  printf '%s' "$status"
}
self_test() {
  local output status
  if env -i PATH="$PATH" bash "$0" --invalid >/dev/null 2>&1; then echo 'FAIL invalid argument accepted'; return 1; fi
  output=$(env -i PATH="$PATH" bash -c 'script=$1; set --; POST_DEPLOY_PROBES_LIBRARY_ONLY=1; source "$script"; require_env' _ "$0" 2>&1); status=$?
  [ "$status" = 2 ] && [ "$output" = 'post-deploy-probes: required environment inputs missing: BASE ANON SMOKE_EMAIL SMOKE_PASSWORD SERVICE JWT_B A_ORG B_ORG A_ROWS_JSON' ] || { echo 'FAIL missing-env diagnostic/exit'; return 1; }
  ALLOW_SKIPS=1
  output=$(parse_summary 'second-org smoke: 12 steps, 0 failed' 'steps=20 fails=0' '=== checks: 40  leaks: 0  probe_errors: 0  skipped: 2 [missing rows]') || { echo 'FAIL summary parse'; return 1; }
  [ "$output" = 'post-deploy probes: org-smoke=12 passed/12, 0 failed; roles-smoke=20 passed/20, 0 failed; isolation=40 passed/40, 0 leaks, 0 probe errors, 2 skipped' ] || { echo "FAIL unexpected summary: $output"; return 1; }
  if parse_summary 'second-org smoke: 12 steps, 0 failed' 'steps=20 fails=0' '=== checks: 40  leaks: 0  probe_errors: 1 [rpc foo HTTP 500]  skipped: 0' >/dev/null; then echo 'FAIL probe errors accepted'; return 1; fi
  [ "$(isolation_exit_status '=== probe_errors: 1' 0 0)" = 4 ] || { echo 'FAIL probe-error exit classification'; return 1; }
  [ "$(isolation_exit_status '=== skipped: 1' 0 0)" = 3 ] || { echo 'FAIL strict-default skip exit classification'; return 1; }
  ALLOW_SKIPS=0
  if parse_summary 'second-org smoke: 12 steps, 0 failed' 'steps=20 fails=0' '=== checks: 40  leaks: 0  probe_errors: 0  skipped: 1 [missing rows]' >/dev/null; then echo 'FAIL strict-default skip accepted'; return 1; fi
  if env -i PATH="$PATH" bash -c 'script=$1; set --; POST_DEPLOY_PROBES_LIBRARY_ONLY=1; source "$script"; RPC_ONLY=1; BASE=x ANON=x SMOKE_EMAIL=x SMOKE_PASSWORD=x SERVICE=x JWT_B=x A_ORG=x B_ORG=x A_ROWS_JSON=/dev/null require_env' _ "$0" >/dev/null 2>&1; then echo 'FAIL RPC_ONLY accepted'; return 1; fi
  node --test "$SCRIPT_DIR/check-isolation-denominator.test.mjs" || return $?
  echo 'PASS post-deploy-probes self-test: argument validation, exact missing-env diagnostic/exit, summary parsing, probe-error exit, strict skips, RPC_ONLY rejection, isolation behavior regressions'
}

[ "${POST_DEPLOY_PROBES_LIBRARY_ONLY:-0}" = 1 ] && return 0
ALLOW_SKIPS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --self-test) [ "$#" -eq 1 ] || { usage >&2; exit 2; }; self_test; exit $? ;;
    --allow-skips) ALLOW_SKIPS=1 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done
require_env || exit $?

org_output=$("$SCRIPT_DIR/second-org-smoke.sh" 2>&1); org_status=$?; printf '%s\n' "$org_output"
roles_output=$("$SCRIPT_DIR/second-org-roles-smoke.sh" 2>&1); roles_status=$?; printf '%s\n' "$roles_output"
probe_strict=1; [ "$ALLOW_SKIPS" = 1 ] && probe_strict=0
isolation_output=$(STRICT="$probe_strict" "$SCRIPT_DIR/isolation-probe.sh" 2>&1); isolation_status=$?; printf '%s\n' "$isolation_output"
parse_summary "$org_output" "$roles_output" "$isolation_output" || summary_status=$?
summary_status=${summary_status:-0}
classified_isolation_status=$(isolation_exit_status "$isolation_output" "$isolation_status" "$ALLOW_SKIPS")
[ "$classified_isolation_status" -eq 0 ] || exit "$classified_isolation_status"
[ "$org_status" -eq 0 ] && [ "$roles_status" -eq 0 ] && [ "$isolation_status" -eq 0 ] && [ "$summary_status" -eq 0 ]
