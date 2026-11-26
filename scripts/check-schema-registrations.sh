#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
if [[ "${PMO_DB_LOCK_HELD:-}" == 1 ]]; then
  exec node "$repo/scripts/check-schema-registrations.mjs" "$@"
fi
exec "$repo/scripts/with-db-lock.sh" node "$repo/scripts/check-schema-registrations.mjs" "$@"
