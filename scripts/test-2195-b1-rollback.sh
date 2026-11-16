#!/usr/bin/env bash
# #2195 B1 rollback proof. Run under scripts/with-db-lock.sh. Records the replaced functions in a database reset to the migration
# before 0882, resets to head, then runs the down in a rolled-back transaction and compares. Ends with the database at head.
set -euo pipefail
cd "$(dirname "$0")/.."
PATH="/opt/homebrew/opt/libpq/bin:$PATH"
test_file="supabase/tests/2195_b1_rollback.generated.test.sql"
hashes="$(mktemp)"
trap 'rm -f "$test_file" "$hashes"' EXIT
# The down of 0903 (which replaces 0882 functions) runs first inside the proof. Static proof: each function 0882 replaces from a recent migration is that migration's body plus only lines marked "-- 0882",
# and the down restores that body verbatim.
python3 - <<'PY'
from pathlib import Path
import re, sys
def body(path, name):
    s = Path(path).read_text()
    starts = [m.start() for m in re.finditer(r'create (or replace )?function public\.' + re.escape(name) + r'\(', s, re.I)]
    if not starts: sys.exit(f'{name} not found in {path}')
    st = starts[-1]
    tag = re.search(r'as (\$[a-z_]*\$)', s[st:], re.I)
    end = s.index(';', s.index(tag.group(1), st + tag.end()) + len(tag.group(1))) + 1
    return re.sub(r'^create (or replace )?function', 'create or replace function', s[st:end], flags=re.I)
up = 'supabase/migrations/0882_capture_invoice_assignment.sql'
down = 'supabase/migrations/rollback/0882_capture_invoice_assignment_down.sql'
for name, source in [('api_client_request_guard', 'supabase/migrations/0876_api_client_dispatch_reads.sql'),
                     ('capture_revision', 'supabase/migrations/0873_capture_revision_fingerprint.sql')]:
    previous = body(source, name)
    stripped = '\n'.join(l for l in body(up, name).split('\n') if not l.rstrip().endswith('-- 0882'))
    if stripped != previous: sys.exit(f'{name}: 0882 body differs from {source} beyond the lines marked 0882')
    if body(down, name) != previous: sys.exit(f'{name}: the down does not restore the body of {source} verbatim')
    print(f'ok {name}: 0882 = {source} + marked lines; down = {source}')
PY
db_url="${PMO_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
prev="$(ls supabase/migrations/*.sql | sed 's#.*/##' | awk -F_ '$1<"0882"{v=$1} END{print v}')"
query="select '''' || p.oid::regprocedure::text || ''',''' || md5(pg_get_functiondef(p.oid)) || ''',''' || coalesce(p.proacl::text,'') || '''' from pg_proc p
 where p.pronamespace='public'::regnamespace and p.proname in ('cost_attribution_engine','cost_attribution_allocations','cost_attribution_org_actuals','cost_attribution_project_actuals','link_erp_purchase_documents','undo_captured_purchase','api_client_request_guard','capture_revision') order by 1"
supabase db reset --no-seed --version "$prev" >/dev/null 2>&1
psql "$db_url" -Atc "$query" | sed 's/^/(/; s/$/)/' > "$hashes"
[ "$(wc -l < "$hashes")" -eq 8 ] || { echo "expected 8 recorded functions"; exit 1; }
paste -sd, "$hashes" > "$hashes.csv" && mv "$hashes.csv" "$hashes"
supabase db reset >/dev/null 2>&1
python3 - "$test_file" "$hashes" <<'PY'
from pathlib import Path
import sys
text = Path('scripts/2195-b1-rollback.test.sql').read_text()
down = Path('supabase/migrations/rollback/0882_capture_invoice_assignment_down.sql').read_text()
if '$down$' in down: raise SystemExit('down file contains the proof delimiter')
text = text.replace('@DOWN@', down).replace('@HASHES@', Path(sys.argv[2]).read_text().strip())
# Peel the newer migration that replaces 0882's functions (0903) inside the proof's transaction first.
text = text.replace('begin;\n', 'begin;\n' + Path('supabase/migrations/rollback/0903_capture_order_family_down.sql').read_text() + '\n', 1)
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
