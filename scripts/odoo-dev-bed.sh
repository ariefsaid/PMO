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
COMPOSE=(docker compose -f "$ROOT/scripts/odoo-bed/compose.yml" --env-file "$ENVF")
MODULES="purchase,stock,account,project,analytic,hr_timesheet,fleet,maintenance"
L10N="l10n_id"

ensure_env() {
  [ -f "$ENVF" ] && return
  umask 077
  { echo "ODOO_DB_PASSWORD=$(openssl rand -hex 12)"
    echo "ODOO_ADMIN_PASSWORD=$(openssl rand -hex 12)"
    echo "ODOO_PORT=8069"; echo "ODOO_DB=pmo_demo"; echo "ODOO_IMAGE=odoo:20.0"; } > "$ENVF"
}
load_env() { set -a; . "$ENVF"; set +a; }
odoo_run() { "${COMPOSE[@]}" run --rm --no-deps -T odoo "$@"; }
psql_db() { "${COMPOSE[@]}" exec -T db psql -U odoo -tA "$@"; }

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
    'maintenance.group_equipment_manager', 'hr.group_hr_manager', 'hr_timesheet.group_timesheet_manager') if env.ref(g, raise_if_not_found=False)]
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
  up)
    ensure_env; load_env
    "${COMPOSE[@]}" up -d db
    until [ "$("${COMPOSE[@]}" ps --format '{{.Health}}' db)" = healthy ]; do sleep 2; done
    seed
    mint_key
    "${COMPOSE[@]}" up -d odoo
    wait_http
    echo "odoo up: http://127.0.0.1:$ODOO_PORT (db $ODOO_DB); probe: node scripts/odoo-probe.mjs"
    ;;
  down) ensure_env; load_env; "${COMPOSE[@]}" stop ;;
  reset)
    ensure_env; load_env
    "${COMPOSE[@]}" down -v --remove-orphans
    sed -i '' '/^ODOO_API_KEY=/d' "$ENVF"
    exec "$0" up
    ;;
  status)
    ensure_env; load_env
    "${COMPOSE[@]}" ps
    psql_db -d "$ODOO_DB" -c "select name, state from ir_module_module where state='installed' and name in ('purchase','stock','account','project','analytic','hr_timesheet','fleet','maintenance','l10n_id') order by 1" 2>&1 || true
    ;;
  *) echo "usage: $0 up|down|reset|status" >&2; exit 2 ;;
esac
