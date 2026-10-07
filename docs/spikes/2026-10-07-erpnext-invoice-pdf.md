# Spike — the ERP's invoice PDF endpoint (#912, plan Task 0)

**Date:** 2026-10-07 · **Bench:** local dev bed, `frappe 15.96.0` / `erpnext 15.94.3`
(`docs/environments.md` § ERPNext dev bed) · run under `scripts/with-erpnext-lock.sh`.

**Method.** Two throwaway bench users were created for the run and deleted afterwards (their keys with
them): one with the `Accounts User` role (Read + Print on Sales Invoice), one with no role. No bench
configuration was changed. Key values never left the shell.

## Observations (v15)

| Request | Answer |
|---|---|
| `GET /api/method/frappe.utils.print_format.download_pdf?doctype=Sales+Invoice&name=<submitted>&no_letterhead=0` | `200`, `Content-Type: application/pdf`, `Content-Disposition: filename=<name>.pdf`, `Content-Length: 21367`; body starts `%PDF-` |
| same, `no_letterhead` omitted | `200`, identical size (the default letterhead is used either way on this bench) |
| same, unknown name `ACC-SINV-NOPE-0` | `404`, `application/json`, `exc_type: DoesNotExistError` |
| same, user with no role | `403`, `application/json` |
| same, a **cancelled** invoice (docstatus 2) | `403`, `application/json`, `exc_type: PermissionError` (Print Settings refuses to print a cancelled document) |
| same, invalid `token` pair | `401`, `application/json`, `exc_type: AuthenticationError` |
| `GET /api/resource/Sales Invoice?filters=[["name","=",<submitted>]]&fields=["name","docstatus"]&limit_page_length=1` | `200` `{"data":[{"name":"ACC-SINV-2026-00003","docstatus":1}]}` |
| same list read, unknown name | `200` `{"data":[]}` |
| same list read, user with no role | `403` |

## Bench-only quirk (not a production concern)

Through the bench's nginx (`localhost:8080`) the render answers **`500` `OSError: wkhtmltopdf reported an
error: … network error: ConnectionRefusedError`**. The bench's nginx forwards `Host $host` (port dropped),
so Frappe tells wkhtmltopdf to fetch the print assets from `http://localhost/…` inside the backend
container, where nothing listens. The 200 rows above were taken directly against the backend worker with
`Host: frontend:8080`, which the backend can reach. A real site has a resolvable public host name and is
not affected. If an ERP were misconfigured this way, PMO would answer `ERP_UNREACHABLE` (5xx) — the
correct class.

## Verdict

**Matches the plan's assumption** — `200`, `application/pdf`, `%PDF-`, and `404` for an unknown name;
`403` without permission; `401` for a bad pair. One addition: the ERP itself refuses to print a cancelled
invoice (`403`), so the live docstatus read before the render (DD-PDF-2) is what keeps a cancelled invoice
from being reported as `ERP_NOT_PERMITTED`.

## v16 test instance

Not a code dependency. Confirming the same request set on v16 is a pre-deploy operator step on the
hosted ERP (owner-held coordinates), recorded here when it is run. The shipped code needs no change for
it: the endpoint, its parameters and the response classes are the ones proven above on v15.
