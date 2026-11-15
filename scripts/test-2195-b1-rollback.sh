#!/usr/bin/env bash
# #2195 B1 rollback proof. Run under scripts/with-db-lock.sh. Records the replaced functions in a database reset to the migration
# before 0882, resets to head, then runs the down in a rolled-back transaction and compares. Ends with the database at head.
set -euo pipefail
cd "$(dirname "$0")/.."
PATH="/opt/homebrew/opt/libpq/bin:$PATH"
test_file="supabase/tests/2195_b1_rollback.generated.test.sql"
hashes="$(mktemp)"
trap 'rm -f "$test_file" "$hashes"' EXIT
db_url="${PMO_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
prev="$(ls supabase/migrations/*.sql | sed 's#.*/##' | awk -F_ '$1<"0882"{v=$1} END{print v}')"
query="select '''' || p.oid::regprocedure::text || ''',''' || md5(pg_get_functiondef(p.oid)) || ''',''' || coalesce(p.proacl::text,'') || '''' from pg_proc p
 where p.pronamespace='public'::regnamespace and p.proname in ('cost_attribution_engine','cost_attribution_allocations','cost_attribution_org_actuals','cost_attribution_project_actuals','link_erp_purchase_documents','undo_captured_purchase','api_client_request_guard') order by 1"
supabase db reset --version "$prev" >/dev/null 2>&1
psql "$db_url" -Atc "$query" | sed 's/^/(/; s/$/)/' > "$hashes"
[ "$(wc -l < "$hashes")" -eq 7 ] || { echo "expected 7 recorded functions"; exit 1; }
paste -sd, "$hashes" > "$hashes.csv" && mv "$hashes.csv" "$hashes"
supabase db reset >/dev/null 2>&1
python3 - "$test_file" "$hashes" <<'PY'
from pathlib import Path
import sys
text = Path('scripts/2195-b1-rollback.test.sql').read_text()
down = Path('supabase/migrations/rollback/0882_capture_invoice_assignment_down.sql').read_text()
if '$down$' in down: raise SystemExit('down file contains the proof delimiter')
text = text.replace('@DOWN@', down).replace('@HASHES@', Path(sys.argv[2]).read_text().strip())
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
