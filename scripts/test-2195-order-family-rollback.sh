#!/usr/bin/env bash
# #2277 order-family rollback proof. Run under scripts/with-db-lock.sh. Records the replaced functions before 0903, resets to head,
# then runs the down in a rolled-back transaction and compares both the restored functions and the request guard at the rollback starting point.
set -euo pipefail
cd "$(dirname "$0")/.."
PATH="/opt/homebrew/opt/libpq/bin:$PATH"
test_file="supabase/tests/2195_order_family_rollback.generated.test.sql"
hashes="$(mktemp)"
trap 'rm -f "$test_file" "$hashes" "$hashes.csv"' EXIT
# Static proof: each function 0903 replaces is its previous body (0896's for undo_captured_purchase, else 0882's) less the lines it replaces
# (counted below) plus only lines marked "-- 0903", the down restores that previous body verbatim, and 0903 does not touch the request guard.
python3 - <<'PY'
from pathlib import Path
import difflib, re, sys
def body(path, name):
    s = Path(path).read_text()
    starts = [m.start() for m in re.finditer(r'create (or replace )?function public\.' + re.escape(name) + r'\(', s, re.I)]
    if not starts: sys.exit(f'{name} not found in {path}')
    st = starts[-1]
    tag = re.search(r'as (\$[a-z_]*\$)', s[st:], re.I)
    end = s.index(';', s.index(tag.group(1), st + tag.end()) + len(tag.group(1))) + 1
    return re.sub(r'^create (or replace )?function', 'create or replace function', s[st:end], flags=re.I)
up = 'supabase/migrations/0903_capture_order_family.sql'
down = 'supabase/migrations/rollback/0903_capture_order_family_down.sql'
sources = {'undo_captured_purchase': 'supabase/migrations/0896_undo_capture_kind_order.sql'}
if 'api_client_request_guard' in Path(up).read_text(): sys.exit('0903 must not replace api_client_request_guard')
# name -> the number of previous-body lines 0903 replaces (each replacement is marked "-- 0903" in 0903's body)
replaced = {'capture_assignment_claim': 2, 'capture_assignment_validate': 2, 'assign_capture_invoices': 7,
            'purchase_capture_assignment_report': 0, 'undo_captured_purchase': 16}
for name, count in replaced.items():
    source = sources.get(name, 'supabase/migrations/0882_capture_invoice_assignment.sql')
    previous = body(source, name).split('\n')
    stripped = [l for l in body(up, name).split('\n') if not l.rstrip().endswith('-- 0903')]
    ops = [op for op in difflib.SequenceMatcher(a=previous, b=stripped, autojunk=False).get_opcodes() if op[0] != 'equal']
    if any(op[0] != 'delete' for op in ops):
        sys.exit(f'{name}: 0903 adds or changes an unmarked line of {source}')
    deleted = sum(op[2] - op[1] for op in ops)
    if deleted != count: sys.exit(f'{name}: 0903 replaces {deleted} lines of {source}, expected {count}')
    if body(down, name) != body(source, name): sys.exit(f'{name}: the down does not restore the body of {source} verbatim')
    print(f'ok {name}: 0903 = {source} - {count} replaced lines + marked lines; down = {source}')
PY
db_url="${PMO_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
prev="$(ls supabase/migrations/*.sql | sed 's#.*/##' | awk -F_ '$1<"0903"{v=$1} END{print v}')"
query="select '''' || p.oid::regprocedure::text || ''',''' || md5(pg_get_functiondef(p.oid)) || ''',''' || coalesce(p.proacl::text,'') || '''' from pg_proc p
 where p.pronamespace='public'::regnamespace and p.proname in ('assign_capture_invoices','capture_assignment_claim','capture_assignment_validate','undo_captured_purchase','purchase_capture_assignment_report') order by 1"
supabase db reset --no-seed --version "$prev" >/dev/null 2>&1
psql "$db_url" -Atc "$query" | sed 's/^/(/; s/$/)/' > "$hashes"
[ "$(wc -l < "$hashes")" -eq 5 ] || { echo "expected 5 recorded functions"; exit 1; }
paste -sd, "$hashes" > "$hashes.csv" && mv "$hashes.csv" "$hashes"
supabase db reset >/dev/null 2>&1
python3 - "$test_file" "$hashes" <<'PY'
from pathlib import Path
import sys
text = Path('scripts/2195-order-family-rollback.test.sql').read_text()
down = Path('supabase/migrations/rollback/0903_capture_order_family_down.sql').read_text()
if '$down$' in down: raise SystemExit('down file contains the proof delimiter')
# Peel any newer migrations in the transaction that modified api_client_request_guard after 0903
downs = []
for p in sorted(Path('supabase/migrations/rollback').glob('*_down.sql'), reverse=True):
    num = p.name.split('_')[0]
    if num > '0903' and 'api_client_request_guard' in p.read_text():
        downs.append(p.read_text())
if downs:
    text = text.replace('begin;\n', 'begin;\n' + '\n'.join(downs) + '\n', 1)
text = text.replace('@DOWN@', down).replace('@HASHES@', Path(sys.argv[2]).read_text().strip())
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
