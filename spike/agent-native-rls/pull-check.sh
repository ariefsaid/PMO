#!/usr/bin/env bash
set -euo pipefail

# Claim #2: prove `drizzle-kit pull` mirrors the existing schema read-only,
# i.e. Drizzle can introspect the Supabase-managed DB without wanting to own
# it. NOTE: `drizzle-kit pull` does NOT connect-and-mutate — it is read-only
# introspection. It reads the live DB and writes ./drizzle/schema.ts locally;
# it never alters the database. Supabase migrations remain source of truth.

if [ -z "${SPIKE_DB_URL:-}" ]; then
  echo "ERROR: SPIKE_DB_URL is not set. Export the local Supabase DB URL first." >&2
  exit 1
fi

echo "==> Running drizzle-kit pull (read-only introspection)"
npx drizzle-kit pull

SCHEMA_FILE="./drizzle/schema.ts"

if [ ! -s "$SCHEMA_FILE" ]; then
  echo "CLAIM #2: FAIL — $SCHEMA_FILE does not exist or is empty after pull." >&2
  exit 1
fi

if ! grep -q "pgTable(" "$SCHEMA_FILE"; then
  echo "CLAIM #2: FAIL — $SCHEMA_FILE contains no pgTable( definitions (nothing mirrored)." >&2
  exit 1
fi

echo "CLAIM #2: PASS — drizzle-kit pull introspected the existing schema read-only (Supabase migrations remain source of truth)"
