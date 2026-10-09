#!/usr/bin/env bash
# Run the post-deploy tenant probes in their required order. Inputs stay in the caller's environment.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { echo "Usage: scripts/post-deploy-probes.sh [--self-test]"; }
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
  if [ -n "${TABLES_JSON:-}" ]; then
    [ -r "$TABLES_JSON" ] || { echo "post-deploy-probes: TABLES_JSON must name a readable file" >&2; return 2; }
  fi
}
parse_summary() {
  local org=$1 roles=$2 isolation=$3
  local org_steps org_fails org_pass roles_steps roles_fails roles_pass checks leaks skipped isolation_pass
  org_steps=$(printf '%s\n' "$org" | sed -nE 's/.*: ([0-9]+) steps,.*/\1/p' | tail -1)
  org_fails=$(printf '%s\n' "$org" | sed -nE 's/.* ([0-9]+) failed.*/\1/p' | tail -1)
  roles_steps=$(printf '%s\n' "$roles" | sed -nE 's/.*steps=([0-9]+).*/\1/p' | tail -1)
  roles_fails=$(printf '%s\n' "$roles" | sed -nE 's/.*fails=([0-9]+).*/\1/p' | tail -1)
  checks=$(printf '%s\n' "$isolation" | sed -nE 's/.*checks: ([0-9]+).*/\1/p' | tail -1)
  leaks=$(printf '%s\n' "$isolation" | sed -nE 's/.*leaks: ([0-9]+).*/\1/p' | tail -1)
  skipped=$(printf '%s\n' "$isolation" | sed -nE 's/.*skipped: ([0-9]+).*/\1/p' | tail -1)
  [ -n "$org_steps" ] && [ -n "$org_fails" ] && [ -n "$roles_steps" ] && [ -n "$roles_fails" ] && [ -n "$checks" ] && [ -n "$leaks" ] && [ -n "$skipped" ] || {
    echo "post-deploy-probes: could not parse all probe summaries" >&2; return 1;
  }
  org_pass=$((org_steps - org_fails)); roles_pass=$((roles_steps - roles_fails)); isolation_pass=$((checks - leaks))
  printf 'post-deploy probes: org-smoke=%s passed/%s, %s failed; roles-smoke=%s passed/%s, %s failed; isolation=%s passed/%s, %s leaks, %s skipped\n' \
    "$org_pass" "$org_steps" "$org_fails" "$roles_pass" "$roles_steps" "$roles_fails" "$isolation_pass" "$checks" "$leaks" "$skipped"
  [ "$org_fails" = 0 ] && [ "$roles_fails" = 0 ] && [ "$leaks" = 0 ] && { [ "${STRICT:-0}" != 1 ] || [ "$skipped" = 0 ]; }
}
self_test() {
  local output
  if env -i PATH="$PATH" bash "$0" --invalid >/dev/null 2>&1; then echo 'FAIL invalid argument accepted'; return 1; fi
  if env -i PATH="$PATH" bash -c 'source "$1"; require_env' _ "$0" >/dev/null 2>&1; then echo 'FAIL missing env accepted'; return 1; fi
  output=$(parse_summary 'second-org smoke: 12 steps, 0 failed' 'steps=20 fails=0' '=== checks: 40  leaks: 0  skipped: 2 [missing rows]') || { echo 'FAIL summary parse'; return 1; }
  [ "$output" = 'post-deploy probes: org-smoke=12 passed/12, 0 failed; roles-smoke=20 passed/20, 0 failed; isolation=40 passed/40, 0 leaks, 2 skipped' ] || { echo "FAIL unexpected summary: $output"; return 1; }
  echo 'PASS post-deploy-probes self-test: argument validation, required-env validation, summary parsing'
}

case "${1:-}" in
  --self-test) [ "$#" -eq 1 ] || { usage >&2; exit 2; }; self_test; exit $? ;;
  "") ;;
  *) usage >&2; exit 2 ;;
esac
require_env || exit $?

org_output=$("$SCRIPT_DIR/second-org-smoke.sh" 2>&1); org_status=$?; printf '%s\n' "$org_output"
roles_output=$("$SCRIPT_DIR/second-org-roles-smoke.sh" 2>&1); roles_status=$?; printf '%s\n' "$roles_output"
isolation_output=$("$SCRIPT_DIR/isolation-probe.sh" 2>&1); isolation_status=$?; printf '%s\n' "$isolation_output"
parse_summary "$org_output" "$roles_output" "$isolation_output" || summary_status=$?
summary_status=${summary_status:-0}
[ "$org_status" -eq 0 ] && [ "$roles_status" -eq 0 ] && [ "$isolation_status" -eq 0 ] && [ "$summary_status" -eq 0 ]
