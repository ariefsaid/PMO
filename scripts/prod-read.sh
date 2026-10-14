#!/usr/bin/env bash
# Read-only SQL against the PRODUCTION database.
#
#   scripts/prod-read.sh -c "select count(*) from public.companies"
#   scripts/prod-read.sh -f query.sql
#   echo "select 1" | scripts/prod-read.sh
#
# The connection URI comes from 1Password via op-get.sh using the committed coordinates in
# supabase/op.prod.env; it is held in a variable and never printed. The session is forced
# read-only (default_transaction_read_only=on), so an INSERT/UPDATE/DDL fails with SQLSTATE 25006.
# psql runs in a throwaway postgres:17-alpine container, so no host psql is needed.
#
# Agents: this is the ONE sanctioned prod read path. Auto mode blocks ad-hoc prod reads
# ("Production Reads"); the owner allow-lists this script instead. Writes stay with
# db-push-prod.sh (migrations) and the app's own paths.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . supabase/op.prod.env; set +a
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"
URL="$("$OP_GET" "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")" || {
  echo "✗ op-get.sh could not resolve the prod DB URL (is 1Password reachable?)" >&2; exit 2; }

case "${1:-}" in
  -c) [ $# -eq 2 ] || { echo "usage: $0 -c '<sql>'" >&2; exit 2; }; SQL="$2" ;;
  -f) [ $# -eq 2 ] || { echo "usage: $0 -f <file.sql>" >&2; exit 2; }; SQL="$(cat "$2")" ;;
  "") SQL="$(cat)" ;;
  *)  echo "usage: $0 [-c '<sql>' | -f <file.sql>]  (or SQL on stdin)" >&2; exit 2 ;;
esac

# The read-only flag is a session default, so SQL could switch it off. Refuse anything that tries.
# ponytail: text guard, not a role boundary — a dedicated read-only DB role is the upgrade path.
if printf '%s' "$SQL" | grep -qiE 'read[_ ]?write|transaction_read_only|set_config|set[[:space:]]+(session|role)|reset[[:space:]]+all|\\(connect|c)\b|\\!'; then
  echo "✗ refused: the SQL tries to change the read-only session or reconnect" >&2; exit 2
fi

printf '%s\n' "$SQL" | docker run --rm -i -e U="$URL" -e PGOPTIONS='-c default_transaction_read_only=on' \
  postgres:17-alpine sh -c 'psql "$U" -X -v ON_ERROR_STOP=1 -P pager=off -f -' 2>&1 \
  | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
