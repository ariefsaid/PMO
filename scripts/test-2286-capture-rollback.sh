#!/usr/bin/env bash
# #2286 PR A rollback proof for migration 0904. Run under scripts/with-db-lock.sh against a database at head.
# Static: the down restores the ledger page of 0866 and the source page of 0873 verbatim. Live: a generated pgTAP file runs
# the down and the up inside one rolled-back transaction and compares the functions' answers (deleted on exit).
set -euo pipefail
cd "$(dirname "$0")/.."
test_file=supabase/tests/2286_capture_rollback.generated.test.sql
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
down = 'supabase/migrations/rollback/0904_capture_volume_reads_down.sql'
for name, source in [('purchase_capture_ledger_page', 'supabase/migrations/0866_erp_purchase_capture.sql'),
                     ('purchase_capture_source_page', 'supabase/migrations/0873_capture_revision_fingerprint.sql')]:
    if body(down, name) != body(source, name): sys.exit(f'{name}: the down does not restore the body of {source} verbatim')
    print(f'ok {name}: down = {source}')
PY
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
text = Path('scripts/2286-capture-volume-rollback.test.sql').read_text()
for marker, source, tag in [('-- @0904_DOWN@', 'supabase/migrations/rollback/0904_capture_volume_reads_down.sql', '$down$'),
                            ('-- @0904_UP@', 'supabase/migrations/0904_capture_volume_reads.sql', '$up$')]:
    sql = Path(source).read_text()
    if tag in sql: raise SystemExit(f'{source} contains the proof delimiter {tag}')
    text = text.replace(marker, sql)
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
