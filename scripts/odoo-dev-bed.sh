#!/usr/bin/env bash
#
# odoo-dev-bed.sh — local stock Odoo 20 Community dev bed (#1504 prerequisite).
#   up      start containers, seed the demo DB if absent (idempotent), mint the probe API key
#   down    stop containers (data kept)
#   reset   destroy containers + volumes, then up
#   status  containers, DB, installed modules
# Localhost-only (127.0.0.1:${ODOO_PORT:-8069}); never touches ERPNext/Supabase containers.
# Local throwaway secrets live ONLY in the untracked .env.odoo.local (generated on first up).
# Wrap state-changing verbs in scripts/with-odoo-lock.sh (lock order: odoo -> erpnext -> db -> test).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/.env.odoo.local"
SHARED_ENV="$HOME/.pmo-odoo-bed.env"
COMPOSE=(docker compose -f "$ROOT/scripts/odoo-bed/compose.yml" --env-file "$ENVF")
MODULES="purchase,stock,account,project,analytic,hr_timesheet,fleet,maintenance"
L10N="l10n_id"

ensure_env() {
  [ -L "$ENVF" ] && [ -f "$ENVF" ] && return
  if [ -f "$ENVF" ]; then
    if [ -e "$SHARED_ENV" ]; then
      echo "Both bed env files exist; reconcile them before continuing" >&2; return 1
    fi
    mv "$ENVF" "$SHARED_ENV"
  fi
  umask 077
  if [ ! -e "$SHARED_ENV" ]; then
    { echo "ODOO_DB_PASSWORD=$(openssl rand -hex 12)"
    echo "ODOO_ADMIN_PASSWORD=$(openssl rand -hex 12)"
    echo "ODOO_PORT=8069"; echo "ODOO_DB=pmo_demo"; echo "ODOO_IMAGE=odoo:20.0"; } > "$SHARED_ENV"
  fi
  chmod 600 "$SHARED_ENV"
  ln -s "$SHARED_ENV" "$ENVF"
}
load_env() { set -a; . "$ENVF"; set +a; }
odoo_run() { "${COMPOSE[@]}" run --rm --no-deps -T odoo "$@"; }
psql_db() { "${COMPOSE[@]}" exec -T db psql -U odoo -tA "$@"; }

# One login attempt over the container's own (first) address; the image trusts loopback, so only a
# non-loopback login actually checks the password. The password is passed by NAME (-e PGPASSWORD) with
# the value in the caller's environment, so it never appears on the host's argv.
probe_once() {
  PGPASSWORD="$ODOO_DB_PASSWORD" "${COMPOSE[@]}" exec -T -e PGPASSWORD db \
    sh -c 'psql -h "$(hostname -i | cut -d" " -f1)" -U odoo -d postgres -tAc "select 1"' 2>&1
}

# Pure: probe exit code + its output -> ok | mismatch | retry.
classify_probe() {
  local rc="$1" out="$2"
  if [ "$rc" -eq 0 ]; then echo ok
  elif [[ "$out" == *"password authentication failed"* ]]; then echo mismatch
  else echo retry; fi
}

# 0 = accepted, 1 = the password was refused, 2 = never reachable (last error line printed, no secrets).
db_accepts_settings() {
  local out="" rc i
  for i in $(seq 1 "${BED_PROBE_TRIES:-15}"); do
    rc=0; out="$(probe_once)" || rc=$?
    case "$(classify_probe "$rc" "$out")" in
      ok) return 0 ;;
      mismatch) return 1 ;;
    esac
    sleep 2
  done
  printf '%s\n' "$out" | grep -v '^[[:space:]]*$' | tail -1 >&2
  return 2
}

# Stops `up` with one plain sentence when the bed refuses the settings it was started with.
check_bed_accepts_settings() {
  local rc=0
  db_accepts_settings || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) echo "The bed's database does not accept the settings in $ENVF; reconcile that file (or $SHARED_ENV) with the one the volumes were created with, or run 'reset'." >&2 ;;
    *) echo "The bed's database did not become reachable over its network address." >&2 ;;
  esac
  return 1
}

wait_http() {
  for _ in $(seq 1 60); do
    curl -fs -o /dev/null "http://127.0.0.1:$ODOO_PORT/web/login" && return 0; sleep 2
  done; echo "odoo did not come up" >&2; return 1
}

seed() {
  mods="$MODULES"
  # -i on an existing db is idempotent (already-installed modules are skipped).
  # l10n_id is best-effort: Community may name/ship it differently.
  "${COMPOSE[@]}" stop odoo >/dev/null 2>&1 || true
  odoo_run odoo -d "$ODOO_DB" -i "$mods" --without-demo=all --stop-after-init 2>&1 | tail -5
  if odoo_run odoo -d "$ODOO_DB" -i "$L10N" --without-demo=all --stop-after-init 2>&1 | tail -3; then :; fi
}

# The Indonesian chart (PPN taxes, IDR) is what the connect capability check and the journeys expect; loaded once, skipped when already loaded.
load_chart() {
  local log; log="$(mktemp)"
  if odoo_run odoo shell -d "$ODOO_DB" --no-http >"$log" 2>&1 <<'PY'
co = self.env.company
if co.chart_template != 'id':
    self.env['account.chart.template'].sudo().try_loading('id', co, install_demo=False)
    self.env.cr.commit()
PY
  then
    rm -f "$log"; return 0
  fi
  # Best effort (the journeys still run on whatever chart is loaded), but never silent: the tail is what explains a missing tax later.
  echo "indonesian chart load skipped (best effort); the odoo shell said:" >&2
  tail -20 "$log" >&2
  rm -f "$log"
}

mint_key() {
  # Create/refresh a dedicated bot user + an API key via odoo shell; key goes to .env.odoo.local only.
  grep -q '^ODOO_API_KEY=' "$ENVF" && return 0
  key="$(odoo_run odoo shell -d "$ODOO_DB" --no-http 2>/dev/null <<'PY' | grep '^KEY=' | cut -d= -f2
env = self.env
Users = env['res.users'].sudo()
u = Users.search([('login', '=', 'pmo_adapter_bot')], limit=1)
if not u:
    u = Users.with_context(no_reset_password=True).create({
        'name': 'PMO adapter bot', 'login': 'pmo_adapter_bot',
        'group_ids': [(6, 0, [env.ref('base.group_user').id])] if 'group_ids' in Users._fields else False,
    })
admin_grp = [g for g in ('base.group_system', 'account.group_account_manager', 'purchase.group_purchase_manager',
    'stock.group_stock_manager', 'project.group_project_manager', 'fleet.fleet_group_manager',
    'maintenance.group_equipment_manager', 'analytic.group_analytic_accounting', 'hr.group_hr_manager', 'hr_timesheet.group_timesheet_manager') if env.ref(g, raise_if_not_found=False)]
field = 'group_ids' if 'group_ids' in Users._fields else 'groups_id'
u.write({field: [(4, env.ref(g).id) for g in admin_grp]})
k = env['res.users.apikeys'].with_user(u)._generate('rpc', 'pmo-dev-bed', None) if hasattr(env['res.users.apikeys'], '_generate') else ''
print('KEY=' + str(k))
env.cr.commit()
PY
)"
  [ -n "$key" ] || { echo "api key mint failed; see docs/research/2026-10-31-odoo20-dev-bed-verification.md" >&2; return 1; }
  echo "ODOO_API_KEY=$key" >> "$ENVF"
}

cmd="${1:-status}"
case "$cmd" in
  --self-test)
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    SHARED_ENV="$tmp/shared.env"; mkdir "$tmp/first" "$tmp/second"
    ENVF="$tmp/first/.env.odoo.local"; ensure_env
    ENVF="$tmp/second/.env.odoo.local"; ensure_env
    [ -L "$tmp/first/.env.odoo.local" ] && [ -L "$ENVF" ]
    cmp -s "$tmp/first/.env.odoo.local" "$ENVF"
    # The live probe (compose exec + psql) is proven only against a real bed; everything around it is covered here.
    ENVF="$tmp/second/.env.odoo.local"
    [ "$(classify_probe 0 "")" = ok ] && [ "$(classify_probe 2 'FATAL: password authentication failed for user "odoo"')" = mismatch ] \
      && [ "$(classify_probe 2 'connection refused')" = retry ] || { echo "self-test: classifier wrong" >&2; exit 1; }
    sleep() { :; }; BED_PROBE_TRIES=3
    probe_once() { echo 'psql: error: connection refused'; return 2; }
    rc=0; db_accepts_settings 2>/dev/null || rc=$?; [ "$rc" -eq 2 ] || { echo "self-test: unreachable should be 2" >&2; exit 1; }
    probe_once() { echo 'FATAL: password authentication failed'; return 2; }
    rc=0; db_accepts_settings || rc=$?; [ "$rc" -eq 1 ] || { echo "self-test: refusal should be 1" >&2; exit 1; }
    probe_once() { echo 1; }
    db_accepts_settings || { echo "self-test: accepted login should be 0" >&2; exit 1; }
    # Messages: refusal names the file (one line); unreachable says so without the reconcile advice.
    db_accepts_settings() { return 1; }
    msg="$(check_bed_accepts_settings 2>&1)" && { echo "self-test: mismatch not detected" >&2; exit 1; }
    case "$msg" in *"does not accept the settings in $ENVF"*"reconcile"*) ;; *) echo "self-test: wrong message: $msg" >&2; exit 1 ;; esac
    [ "$(printf '%s\n' "$msg" | wc -l)" -eq 1 ]
    db_accepts_settings() { return 2; }
    msg="$(check_bed_accepts_settings 2>&1)" && { echo "self-test: unreachable not detected" >&2; exit 1; }
    case "$msg" in *"did not become reachable"*) ;; *) echo "self-test: wrong message: $msg" >&2; exit 1 ;; esac
    case "$msg" in *reconcile*) echo "self-test: unreachable must not say reconcile" >&2; exit 1 ;; esac
    db_accepts_settings() { return 0; }
    check_bed_accepts_settings
    # `up` must run the check before it seeds anything.
    awk '/^  up\)/{u=1} u&&/check_bed_accepts_settings/{c=NR} u&&/^    seed$/{s=NR} u&&/;;/{exit} END{exit !(c && s && c<s)}' "$0" \
      || { echo "self-test: up must call check_bed_accepts_settings before seed" >&2; exit 1; }
    echo "shared bed env self-test passed"
    ;;
  up)
    ensure_env; load_env
    "${COMPOSE[@]}" up -d db
    until [ "$("${COMPOSE[@]}" ps --format '{{.Health}}' db)" = healthy ]; do sleep 2; done
    check_bed_accepts_settings
    seed
    load_chart
    mint_key
    "${COMPOSE[@]}" up -d odoo
    wait_http
    echo "odoo up: http://127.0.0.1:$ODOO_PORT (db $ODOO_DB); probe: node scripts/odoo-probe.mjs"
    ;;
  down) ensure_env; load_env; "${COMPOSE[@]}" stop ;;
  reset)
    ensure_env; load_env
    "${COMPOSE[@]}" down -v --remove-orphans
    sed -i '' '/^ODOO_API_KEY=/d' "$SHARED_ENV"
    exec "$0" up
    ;;
  status)
    ensure_env; load_env
    "${COMPOSE[@]}" ps
    psql_db -d "$ODOO_DB" -c "select name, state from ir_module_module where state='installed' and name in ('purchase','stock','account','project','analytic','hr_timesheet','fleet','maintenance','l10n_id') order by 1" 2>&1 || true
    ;;
  *) echo "usage: $0 up|down|reset|status" >&2; exit 2 ;;
esac
