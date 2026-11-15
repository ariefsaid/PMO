#!/usr/bin/env bash
# #2286 PR B rollback proof for migration 0905. Run under scripts/with-db-lock.sh against a database at head.
# Static: the down restores the batch and the fence trigger of 0866 and the group apply of 0868 verbatim. Live: a generated
# pgTAP file runs the down and the up inside one rolled-back transaction and compares the batch's answers (deleted on exit).
set -euo pipefail
cd "$(dirname "$0")/.."
test_file=supabase/tests/2286_capture_apply_rollback.generated.test.sql
trap 'rm -f "$test_file"' EXIT
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
down = 'supabase/migrations/rollback/0905_capture_volume_apply_down.sql'
# The down restores these sources, so each must still be the latest definition before 0905: a later migration that redefines
# one of them would make the down restore a stale body.
earlier = sorted(f for f in Path('supabase/migrations').glob('[0-9][0-9][0-9][0-9]_*.sql') if int(f.name[:4]) < 905)
for name, source in [('capture_history_batch', '0866_erp_purchase_capture.sql'), ('capture_history_apply_internal', '0868_captured_invoice_payment.sql'),
                     ('fence_capture_source_change', '0866_erp_purchase_capture.sql')]:
    pattern = re.compile(r'create (or replace )?function public\.' + re.escape(name) + r'\(', re.I)
    latest = [f.name for f in earlier if pattern.search(f.read_text())][-1:]
    if latest != [source]: sys.exit(f'{name}: the latest definition before 0905 is {latest}, not {source}; rebuild the 0905 down from it')
    print(f'ok {name}: latest before 0905 = {source}')
for name, source in [('capture_history_batch', 'supabase/migrations/0866_erp_purchase_capture.sql'),
                     ('capture_history_apply_internal', 'supabase/migrations/0868_captured_invoice_payment.sql'),
                     ('fence_capture_source_change', 'supabase/migrations/0866_erp_purchase_capture.sql')]:
    if body(down, name) != body(source, name): sys.exit(f'{name}: the down does not restore the body of {source} verbatim')
    print(f'ok {name}: down = {source}')
PY
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
text = Path('scripts/2286-capture-apply-rollback.test.sql').read_text()
for marker, source, tag in [('-- @0905_DOWN@', 'supabase/migrations/rollback/0905_capture_volume_apply_down.sql', '$down$'),
                            ('-- @0905_UP@', 'supabase/migrations/0905_capture_volume_apply.sql', '$up$')]:
    sql = Path(source).read_text()
    if tag in sql: raise SystemExit(f'{source} contains the proof delimiter {tag}')
    text = text.replace(marker, sql)
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
