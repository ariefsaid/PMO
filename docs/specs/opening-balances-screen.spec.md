# Opening balances screen (read-only)

Branch feat/1124d-setup · migration 2161 · proof: `supabase/tests/2161_opening_balances_overview.test.sql`, `pmo-portal/pages/finance/OpeningBalances.test.tsx`, `pmo-portal/src/lib/db/openingBalances.test.ts`.

**Job story.** After go-live loading, Finance or an Admin opens one screen to see what was loaded, when and by whom, and to check the totals against the source file.

## Requirements (EARS)
- **FR-OBS-001** Where the reader is Admin or Finance, the system shall show every live opening balance of the organisation: stock per location and item (quantity, value at cost) and each running work order's lines (certified and claimed quantity, claimed value).
- **FR-OBS-002** Each opening shall show the go-live date, when it was loaded and by whom.
- **FR-OBS-003** The screen shall show reconciliation totals (stock value, certified value, already-invoiced value) per currency, never adding two currencies, and say where the loaded figures are all it can compare.
- **FR-OBS-004** The screen is read-only; loading and reversing stay with the CLI. The page is linked from the Finance hub.
- **FR-OBS-005** The read is a database function that refuses any role other than Admin and Finance (the stock value is cost), scopes to the caller's organisation and refuses a light account.
- **FR-OBS-006** The screen and its read are available only after an Admin enables setup workflows for the organisation; no setting row means off.

## Acceptance criteria
- **AC-OBS-001** Given an Admin or Finance member, then the function returns the openings; a Project Manager is refused (42501); anon cannot execute it. *(pgTAP)*
- **AC-OBS-002** Given loaded openings, then the load date, who loaded and per-item figures are returned. *(pgTAP, unit)*
- **AC-OBS-003** Given another organisation, then none of these are visible. *(pgTAP)*
- **AC-OBS-004** Given loaded openings, the screen shows each location with its items, the date and who loaded. *(unit)*
- **AC-OBS-005** Totals are summed per currency and the note says source totals are not kept. *(unit)*
- **AC-OBS-006** Given a role without the right, no data is requested or shown. *(unit)*
- **AC-OBS-007** Given an organisation with no setup-workflow setting row, then the page asks its Admin to enable the feature and requests no opening data; after an Admin opts in, Finance can follow the Finance hub link. *(pgTAP, unit)*

## Open
Source-file totals are not recorded by the loaders today, so a match/difference against them cannot be shown; receivables, payables and site cash floats have no loader. See `docs/briefs/decisions-1124/setup-open.md`.
