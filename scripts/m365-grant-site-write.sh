#!/usr/bin/env bash
#
# m365-grant-site-write.sh — OWNER-RUN, one-off: grant the PMO Entra app the `write` role on ONE SharePoint
# site (ADR-0089, FR-M365DOC-070). With the delegated `Sites.Selected` consent this is what lets PMO create
# a record folder, and ONLY on that site, only as the signed-in user (Microsoft intersects both rights).
#
#   scripts/m365-grant-site-write.sh --site-id <site-id> --app-id <app-client-uuid> [--dry-run|--execute]
#
# DRY-RUN IS THE DEFAULT: it prints the single Graph request and contacts nothing. `--execute` uses the
# operator's ALREADY-AUTHENTICATED Azure CLI session (`az rest`) and needs a Microsoft admin identity with
# authority to grant site permissions — PMO's own delegated app cannot grant itself rights. This script
# performs no login, reads no secret, takes no token argument, retries nothing and never uses an app-only
# production connection. It prints a generic result, never the permission response body.
#
# An agent never runs --execute; the owner does, once, after reviewing the dry-run output.
set -euo pipefail

usage() {
  echo "usage: $0 --site-id <site-id> --app-id <app-client-uuid> [--dry-run|--execute]" >&2
  exit 2
}
die() { echo "error: $*" >&2; exit 2; }

site_id="" app_id="" mode=""
seen_site=0 seen_app=0
while [ $# -gt 0 ]; do
  case "$1" in
    --site-id)
      [ "$seen_site" -eq 0 ] || die "duplicate --site-id"
      [ $# -ge 2 ] || die "--site-id needs a value"
      seen_site=1; site_id="$2"; shift 2 ;;
    --app-id)
      [ "$seen_app" -eq 0 ] || die "duplicate --app-id"
      [ $# -ge 2 ] || die "--app-id needs a value"
      seen_app=1; app_id="$2"; shift 2 ;;
    --dry-run|--execute)
      [ -z "$mode" ] || die "choose only one of --dry-run / --execute (given: $mode and $1)"
      mode="$1"; shift ;;
    -h|--help) usage ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ "$seen_site" -eq 1 ] && [ "$seen_app" -eq 1 ] || usage
mode="${mode:---dry-run}"

# Site id: opaque SharePoint id (e.g. host,siteGuid,webGuid) — no path, query, escape or whitespace characters.
if ! [[ "$site_id" =~ ^[A-Za-z0-9][A-Za-z0-9._,-]{0,254}$ ]] || [[ "$site_id" == *..* ]]; then
  die "--site-id must be an opaque site id (letters, digits, '.', ',', '-', '_'; no path or query characters)"
fi
# App id: a UUID.
if ! [[ "$app_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  die "--app-id must be the app (client) UUID"
fi
command -v jq >/dev/null 2>&1 || die "jq is required"

encoded_site="$(jq -rn --arg s "$site_id" '$s|@uri')"
url="https://graph.microsoft.com/v1.0/sites/${encoded_site}/permissions"
body="$(jq -nc --arg app "$app_id" '{roles:["write"],grantedToIdentities:[{application:{id:$app}}]}')"

if [ "$mode" = "--dry-run" ]; then
  echo "DRY RUN — nothing was sent. The one request --execute would make:"
  echo "POST $url"
  echo "$body" | jq .
  exit 0
fi

command -v az >/dev/null 2>&1 || die "Azure CLI (az) is required for --execute and must already be signed in as a Microsoft admin"
az rest --method POST --url "$url" --headers Content-Type=application/json --body "$body" --output none >/dev/null
echo "Granted: the app now has the write role on the selected site (request accepted)."
