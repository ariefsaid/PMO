#!/usr/bin/env bash
# Run the agent evals against the local Supabase stack with its published JWT issuer.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/pmo-portal"
cd "$REPO_ROOT"

die() {
  printf 'agent-eval-local: %s\n' "$1" >&2
  exit 1
}

cleanup_dir=''
cleanup_serve_pid=''
cleanup_stock_off_db=''
cleanup_local_eval() {
  local status_code=$?
  trap - EXIT INT TERM HUP
  if [[ -n "${cleanup_serve_pid:-}" ]]; then
    kill "$cleanup_serve_pid" 2>/dev/null || true
    wait "$cleanup_serve_pid" 2>/dev/null || true
  fi
  # The plans-switch-off fixture is a database write, so remove it inside the same lock hold
  # (a later `db reset` would also clear it, but a failed run must not leave stock off).
  if [[ -n "${cleanup_stock_off_db:-}" ]]; then
    docker exec "$cleanup_stock_off_db" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
      "delete from public.org_features where org_id = '00000000-0000-0000-0000-000000000001' and feature_key = 'stock';" \
      >/dev/null 2>&1 || printf 'agent-eval-local: warning: could not remove the stock-off override\n' >&2
  fi
  if [[ -n "${cleanup_dir:-}" && -d "$cleanup_dir" ]]; then
    for file in "$cleanup_dir"/agent-chat.env "$cleanup_dir"/serve.log "$cleanup_dir"/eval-*.log; do
      [[ ! -f "$file" ]] || rm "$file"
    done
    rmdir "$cleanup_dir"
  fi
  exit "$status_code"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

# Model transport: today's OpenRouter key, OR an all-or-nothing override (base URL + key + model)
# for a local eval run. Production never sets the override. The key VALUE is supplied by the
# caller's environment; this script never fetches a secret.
MODEL_TRANSPORT=''
validate_model_transport() {
  local set_count=0 missing='' var
  for var in AGENT_MODEL_BASE_URL AGENT_MODEL_API_KEY AGENT_MODEL_ID; do
    if [[ -n "${!var:-}" ]]; then
      set_count=$((set_count + 1))
    else
      missing+="$var "
    fi
  done
  if [[ "$set_count" != '0' && "$set_count" != '3' ]]; then
    die "the model override is all-or-nothing; missing: ${missing% }"
  fi
  if [[ "$set_count" == '3' ]]; then
    [[ -z "${OPENROUTER_API_KEY:-}" ]] || die 'set the model override trio OR OPENROUTER_API_KEY, never both'
    MODEL_TRANSPORT='override'
  else
    [[ -n "${OPENROUTER_API_KEY:-}" ]] || die 'set OPENROUTER_API_KEY, or all three of AGENT_MODEL_BASE_URL, AGENT_MODEL_API_KEY and AGENT_MODEL_ID'
    MODEL_TRANSPORT='openrouter'
  fi
}

read_local_env() {
  local status_json discovery jwks
  status_json="$(supabase status --output json 2>/dev/null)" || die 'local Supabase is not running; start it before running the evals'

  LOCAL_API_URL="$(printf '%s' "$status_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.API_URL||"")})')"
  LOCAL_ANON_KEY="$(printf '%s' "$status_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.ANON_KEY||"")})')"
  [[ -n "$LOCAL_API_URL" && -n "$LOCAL_ANON_KEY" ]] || die 'local Supabase status did not provide its API URL and anon key'

  discovery="$(curl --connect-timeout 2 --max-time 5 -fsS "$LOCAL_API_URL/auth/v1/.well-known/openid-configuration")" || die 'local Auth OpenID metadata is unavailable'
  LOCAL_AUTH_ISSUER="$(printf '%s' "$discovery" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.issuer||"")})')"
  [[ -n "$LOCAL_AUTH_ISSUER" ]] || die 'local Auth metadata did not publish an issuer'

  jwks="$(curl --connect-timeout 2 --max-time 5 -fsS "$LOCAL_API_URL/auth/v1/.well-known/jwks.json")" || die 'local Auth JWKS is unavailable'
  printf '%s' "$jwks" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const x=JSON.parse(s);const ok=(x.keys||[]).some(k=>k.alg==="ES256"&&k.kty==="EC"&&k.crv==="P-256");if(!ok)process.exit(1)})' || die 'local Auth JWKS has no ES256 P-256 signing key required by verifyCallerJwt'
}

preflight() {
  local project_id db_container health

  for command in supabase docker curl node npm python3; do
    require_command "$command"
  done

  [[ -x "$SCRIPT_DIR/with-db-lock.sh" ]] || die 'scripts/with-db-lock.sh is unavailable'
  [[ -f "$APP_DIR/package.json" && -f "$APP_DIR/vitest.eval.config.ts" ]] || die 'the pmo-portal eval project is unavailable'
  [[ -x "$APP_DIR/node_modules/.bin/vitest" ]] || die 'pmo-portal dependencies are missing; run npm ci in pmo-portal'
  [[ -f "$REPO_ROOT/supabase/functions/agent-chat/index.ts" ]] || die 'the agent-chat function source is unavailable'
  [[ -f "$REPO_ROOT/supabase/seed.sql" ]] || die 'the local Supabase seed is unavailable'
  [[ -n "${EVAL_TEST_USER_EMAIL:-}" ]] || die 'set EVAL_TEST_USER_EMAIL to the local Finance test user'
  [[ -n "${EVAL_TEST_USER_PASSWORD:-}" ]] || die 'set EVAL_TEST_USER_PASSWORD to the local Finance test user password'
  validate_model_transport

  project_id="$(sed -n 's/^project_id = "\([^"]*\)"/\1/p' "$REPO_ROOT/supabase/config.toml" | head -n 1)"
  [[ -n "$project_id" ]] || die 'could not read project_id from supabase/config.toml'
  db_container="supabase_db_${project_id}"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container" 2>/dev/null)" || die 'local Supabase database container is unavailable'
  [[ "$health" == 'healthy' || "$health" == 'running' ]] || die 'local Supabase database container is not healthy'
  docker exec "$db_container" psql --version >/dev/null 2>&1 || die 'psql is unavailable in the local Supabase database container'

  read_local_env

}

print_redacted_summary() {
  local log_file="$1"
  python3 - "$log_file" <<'PY'
import pathlib
import re
import sys
import os

text = pathlib.Path(sys.argv[1]).read_text(errors="replace")
for value in (
    os.environ.get("EVAL_TEST_USER_EMAIL", ""),
    os.environ.get("EVAL_TEST_USER_PASSWORD", ""),
    os.environ.get("VITE_SUPABASE_ANON_KEY", ""),
    os.environ.get("OPENROUTER_API_KEY", ""),
    os.environ.get("AGENT_MODEL_API_KEY", ""),
):
    if value:
        text = text.replace(value, "[REDACTED]")
text = re.sub(r"(?i)Bearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]", text)
text = re.sub(r"(?i)sk-or-v1-[A-Za-z0-9_-]+", "[REDACTED_KEY]", text)
patterns = re.compile(r"(^\s*RUN\s|Test Files|Tests\s|Duration\s|agent-chat HTTP \d{3}:)", re.I)
# Per-case result lines (status only, never a scorer's raw answer text): the brief needs
# per-case counts, and a bare Test Files total cannot supply them.
status = re.compile(r"^\s*(?:\u2713|\u00d7|\u2193)\s")
transport = re.compile(r"agent-chat HTTP \d{3}:|judge model call failed|ECONN|EPIPE|timed out")
out = []
for line in text.splitlines():
    if patterns.search(line) or status.match(line):
        out.append(line)
    elif "\u2192" in line and transport.search(line):
        out.append("   " + line.strip()[:200])
print("\n".join(out[-140:]) if out else "No matching score or error metadata was emitted.")
PY
}

run_locked() {
  local run_count="$1"
  local project_id db_container work_dir env_file serve_log serve_pid="" overall_status=0 run status attempt http_status eval_args case_files
  [[ "${PMO_DB_LOCK_HELD:-}" == '1' ]] || die 'internal locked mode requires scripts/with-db-lock.sh'

  project_id="$(sed -n 's/^project_id = "\([^"]*\)"/\1/p' "$REPO_ROOT/supabase/config.toml" | head -n 1)"
  db_container="supabase_db_${project_id}"
  read_local_env
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-eval-local.XXXXXX")" || die 'could not create a private temporary directory'
  chmod 700 "$work_dir"
  env_file="$work_dir/agent-chat.env"
  serve_log="$work_dir/serve.log"
  cleanup_dir="$work_dir"
  trap cleanup_local_eval EXIT INT TERM HUP

  validate_model_transport
  if [[ "$MODEL_TRANSPORT" == 'override' ]]; then
    printf 'AGENT_MODEL_BASE_URL=%s\nAGENT_MODEL_API_KEY=%s\nAGENT_MODEL_ID=%s\n' \
      "$AGENT_MODEL_BASE_URL" "$AGENT_MODEL_API_KEY" "$AGENT_MODEL_ID" > "$env_file"
    # Optional provider-required headers (e.g. a routing/session id), `name=value;…` form.
    if [[ -n "${AGENT_MODEL_EXTRA_HEADERS:-}" ]]; then
      printf 'AGENT_MODEL_EXTRA_HEADERS=%s\n' "$AGENT_MODEL_EXTRA_HEADERS" >> "$env_file"
    fi
  else
    printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY" > "$env_file"
  fi
  # Local eval runs fire far more than a person does (each case is one request, repeated N times), so
  # the per-user/min agent throttle is raised HERE only. The function's production default (20) is unchanged.
  printf 'EDGE_JWT_ISSUER=%s\nAGENT_RATE_LIMIT_PER_MIN=%s\n' "$LOCAL_AUTH_ISSUER" '1000' >> "$env_file"
  chmod 600 "$env_file"

  printf 'Resetting the local Supabase database and applying the eval fixtures.\n'
  supabase db reset --yes

  printf 'Provisioning local eval fixtures.\n'
  docker exec -i "$db_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;

insert into public.org_features (org_id, feature_key, enabled)
values ('00000000-0000-0000-0000-000000000001', 'revenue', true)
on conflict (org_id, feature_key) do update set enabled = excluded.enabled, updated_at = now();

insert into public.projects
  (id, org_id, code, name, status, client_id, project_manager_id, currency,
   contract_value, tax_treatment, tax_amount, budget, spent, start_date, end_date)
values
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001',
   'EVAL-P1', 'Agent evaluation project', 'Ongoing Project',
   'c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   'IDR', 5000000, 'exclusive', 0, 5000000, 0, current_date - 365, current_date + 365);

insert into public.project_milestones (id, org_id, project_id, name, sort_order, target_date)
values
  ('e0000000-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'Evaluation milestone 1', 1, current_date + 30),
  ('e0000000-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'Evaluation milestone 2', 2, current_date + 60);

insert into public.work_orders
  (id, org_id, project_id, wo_number, title, status, order_value, currency, tax_treatment, tax_amount)
values
  ('e0000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'WO-EVAL-0001', 'Evaluation work order',
   'Issued', 1000000, 'IDR', 'exclusive', 0);

insert into public.sales_invoices
  (id, org_id, project_id, customer_id, si_number, invoice_date, erp_due_date,
   amount, erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus)
values
  ('e0000000-0000-4000-8000-000000000041', '00000000-0000-0000-0000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-0000-0000-000000000002',
   'SI-EVAL-0001', current_date - 60, current_date - 30,
   250000, 250000, 'exclusive', 0, 'IDR', 'Unpaid', 1);

insert into public.tasks (id, org_id, project_id, name, start_date, end_date, assignee_id, status)
values
  ('e0000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'EVAL overdue task for reminder',
   date '0001-01-01', date '0001-01-01', '00000000-0000-0000-0000-0000000000a2', 'To Do'),
  ('e0000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'EVAL own overdue task',
   date '0001-01-01', date '0001-01-01', '00000000-0000-0000-0000-0000000000a3', 'To Do');

do $$
begin
  if not exists (
    select 1 from public.org_features
     where org_id = '00000000-0000-0000-0000-000000000001'
       and feature_key = 'revenue' and enabled
  ) then
    raise exception 'eval Revenue feature is not enabled';
  end if;
  if exists (
    select 1 from public.external_domain_ownership
     where org_id = '00000000-0000-0000-0000-000000000001' and domain = 'revenue'
  ) then
    raise exception 'eval fixture requires native revenue with no external owner';
  end if;
  if (select count(*) from public.project_milestones where project_id = 'e0000000-0000-4000-8000-000000000001') < 2 then
    raise exception 'eval milestone fixture is incomplete';
  end if;
  if not exists (
    select 1 from public.work_orders
     where wo_number = 'WO-EVAL-0001' and status = 'Issued' and order_value = 1000000
       and tax_treatment = 'exclusive' and tax_amount = 0
  ) then
    raise exception 'eval work-order fixture is incomplete';
  end if;
  if not exists (select 1 from public.sales_invoices where si_number = 'SI-EVAL-0001' and status = 'Unpaid' and erp_due_date < current_date) then
    raise exception 'eval overdue-invoice fixture is incomplete';
  end if;
  if (select count(*) from public.tasks where name in ('EVAL overdue task for reminder', 'EVAL own overdue task') and status = 'To Do') <> 2 then
    raise exception 'eval reminder-task fixtures are incomplete';
  end if;
  if not exists (
    select 1 from public.tasks
     where name = 'EVAL overdue task for reminder'
       and assignee_id = '00000000-0000-0000-0000-0000000000a2'
       and end_date = date '0001-01-01'
  ) or not exists (
    select 1 from public.tasks
     where name = 'EVAL own overdue task'
       and assignee_id = '00000000-0000-0000-0000-0000000000a3'
       and end_date = date '0001-01-01'
  ) then
    raise exception 'eval reminder-task assignments are incomplete';
  end if;
end
$$;

commit;
SQL

  if [[ "${EVAL_STOCK_OFF:-}" == '1' ]]; then
    printf 'Disabling the stock feature for the plans-switch-off fixture.\n'
    docker exec -i "$db_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
insert into public.org_features (org_id, feature_key, enabled)
values ('00000000-0000-0000-0000-000000000001', 'stock', false)
on conflict (org_id, feature_key) do update set enabled = excluded.enabled, updated_at = now();
SQL
    # Removed by cleanup_local_eval, still inside this lock hold.
    cleanup_stock_off_db="$db_container"
  fi

  export EVAL_AGENT_CHAT_URL="$LOCAL_API_URL/functions/v1/agent-chat"
  export VITE_SUPABASE_URL="$LOCAL_API_URL"
  export VITE_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"

  : > "$serve_log"
  supabase functions serve agent-chat --env-file "$env_file" --no-verify-jwt > "$serve_log" 2>&1 &
  serve_pid=$!
  cleanup_serve_pid="$serve_pid"
  printf 'Waiting for the local agent-chat function.\n'
  for attempt in $(seq 1 60); do
    http_status="$(curl --connect-timeout 1 --max-time 2 -sS -o /dev/null -w '%{http_code}' -X OPTIONS "$EVAL_AGENT_CHAT_URL" 2>/dev/null || true)"
    if [[ "$http_status" == '200' ]]; then break; fi
    if ! kill -0 "$serve_pid" 2>/dev/null; then die 'supabase functions serve stopped before agent-chat became ready'; fi
    sleep 1
  done
  [[ "$http_status" == '200' ]] || die 'local agent-chat did not become ready within 60 seconds'

  for ((run = 1; run <= run_count; run++)); do
    run_log="$work_dir/eval-$run.log"
    : > "$run_log"
    printf '\nRunning agent eval suite %d/%d.\n' "$run" "$run_count"
    eval_args=(--reporter=verbose)
    if [[ -n "${EVAL_CASE_FILES:-}" ]]; then
      read -r -a case_files <<< "$EVAL_CASE_FILES"
      eval_args+=("${case_files[@]}")
    fi
    if (cd "$APP_DIR" && npm run test:evals -- "${eval_args[@]}") > "$run_log" 2>&1; then
      status=0
    else
      status=$?
      overall_status=1
    fi
    print_redacted_summary "$run_log"
    printf 'Suite run exit code: %d\n' "$status"
  done

  if [[ "$overall_status" == '0' ]]; then
    printf '\nLocal agent eval suite completed successfully.\n'
  else
    printf '\nLocal agent eval suite produced red eval cases; see the score and redacted HTTP metadata above.\n' >&2
  fi
  return "$overall_status"
}

if [[ "${1:-}" == '--locked' ]]; then
  [[ "$#" == '2' ]] || die 'invalid internal invocation'
  [[ "${PMO_DB_LOCK_HELD:-}" == '1' ]] || die 'internal locked mode requires scripts/with-db-lock.sh'
  run_locked "$2"
  exit $?
fi

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  cat <<'HELP'
Usage: N=1 scripts/agent-eval-local.sh [--dry-run]

N is the number of serial eval-suite runs (default: 1). Set
EVAL_TEST_USER_EMAIL and EVAL_TEST_USER_PASSWORD in the process environment,
and supply the model transport EITHER as OPENROUTER_API_KEY (production
provider) OR as all three of AGENT_MODEL_BASE_URL, AGENT_MODEL_API_KEY and
AGENT_MODEL_ID (an OpenAI-compatible provider; paste the key yourself).
Never set both. The override runs make no production-provider call.
AGENT_MODEL_EXTRA_HEADERS optionally adds provider-required request headers
in name=value;name2=value2 form.

EVAL_CASE_FILES limits each run to the named eval case files (space-separated,
relative to pmo-portal, e.g. evals/cases/tool-selection.eval.ts).
EVAL_STOCK_OFF=1 disables the stock feature for the run (the plans-switch-off
fixture) and removes that override before the lock is released.
--dry-run checks prerequisites, but does not reset or write to the local
database.
HELP
  exit 0
fi

dry_run='no'
if [[ "${1:-}" == '--dry-run' ]]; then
  [[ "$#" == '1' ]] || die '--dry-run does not accept other arguments'
  dry_run='yes'
elif [[ "$#" != '0' ]]; then
  die 'use --help for usage'
fi

run_count="${N:-1}"
[[ "$run_count" =~ ^[1-9][0-9]*$ ]] || die 'N must be a positive integer'
preflight

if [[ "$dry_run" == 'yes' ]]; then
  printf 'Dry run passed: local Supabase + ES256 JWKS, eval dependencies, Finance credentials, Docker/psql, and the process model credentials (%s transport) are available. No database reset or write was performed.\n' "$MODEL_TRANSPORT"
  exit 0
fi

exec "$SCRIPT_DIR/with-db-lock.sh" "$SCRIPT_DIR/agent-eval-local.sh" --locked "$run_count"
