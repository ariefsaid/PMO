#!/usr/bin/env bash
# Run under the DB then test lock outside isolated CI. The generated proof is
# one transaction and never leaves changes in the shared database.
set -euo pipefail
cd "$(dirname "$0")/.."
test_file="supabase/tests/2195_capture_rollback.generated.test.sql"
trap 'rm -f "$test_file"' EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import re
import sys

def reference(path, name, alias, args):
    source = Path(path).read_text()
    match = re.search(r'create(?: or replace)? function public\.' + name + r'\([\s\S]*?\nend \$\$;', source, re.I)
    if match is None:
        raise SystemExit('missing predecessor function: ' + name)
    definition = match.group().replace('public.' + name + '(', 'public.' + alias + '(', 1)
    return (definition + '\nrevoke all on function public.' + alias + '(' + args + ') from public, anon;\n'
            + 'grant execute on function public.' + alias + '(' + args + ') to authenticated;\n')

refs = reference('supabase/migrations/0858_record_only_journal.sql', 'undo_captured_purchase',
                 'p0_proof_undo_reference', 'uuid,text,boolean')
refs += reference('supabase/migrations/0372_procurement_link_integrity.sql', 'unlink_erp_purchase_document',
                  'p0_proof_unlink_reference', 'uuid')
# The forward state is 0866 plus the migrations stacked on it; the down state undoes them newest first.
ups = ['0866_erp_purchase_capture.sql', '0873_capture_revision_fingerprint.sql']
downs = ['0873_capture_revision_fingerprint_down.sql', '0866_erp_purchase_capture_down.sql']
up_sql = '\n'.join(Path('supabase/migrations/' + name).read_text() for name in ups)
down_sql = '\n'.join(Path('supabase/migrations/rollback/' + name).read_text() for name in downs)
text = Path('scripts/2195-capture-rollback.test.sql').read_text()
for marker, value, expected in [
    ('-- @REFS@', refs, 1),
    ('-- @UP@', up_sql, 2),
    ('-- @DOWN@', down_sql, 3),
]:
    if text.count(marker) != expected:
        raise SystemExit('unexpected marker count: ' + marker)
    text = text.replace(marker, value)
Path(sys.argv[1]).write_text(text)
PY
supabase test db "$test_file"
