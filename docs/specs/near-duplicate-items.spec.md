# Spec: Near-duplicate warning on a new stock item (#2692)

**Status:** agreed form in the issue; no owner decision is open. Map #2516, target 15 December 2026. IDs `FR-NDI-###`, `NFR-NDI-###`, `AC-NDI-###`. Plan: `docs/plans/2026-11-21-near-duplicate-items.md`. Size S. Not money path: it reads item names and writes nothing.

## Job story

When I add a stock item, I want a warning if a similar one exists, so the item master stays clean.

## What ships

A warning inside the **new item** form when the typed name closely matches an existing item of the organisation, listing each close match with a link to that item. The warning never blocks: the create button stays enabled, nothing is validated against it, and the write is never refused.

**Settings the client controls:** none. The ticket states none, and the feature is advisory only, so no organisation's data, permissions or writes change. An organisation that never types a near-duplicate sees the form exactly as it is today.

## Not in this ticket

Nothing deferred. Adjacent surfaces are named here so they are not mistaken for omissions:

- **Import** of stock items (`ImportButton`, `makeStockItemImportDescriptor`) has no per-row advisory state today; adding one changes the shared import framework, not this form.
- **Other master records** (units, warehouses) keep their current validation; the ticket's subject is a stock item name.
- **A merge/replace flow** for a duplicate is not proposed; the link lets the person look at the existing item and decide.

## Definitions

- **Normalised name** — the item name lowercased, its diacritics removed, and every character that is not a Latin letter or a digit dropped. Case, spacing, punctuation and accent differences therefore disappear: `Cement 50 kg`, `CEMENT 50KG` and `cement-50kg` all normalise to `cement50kg`.
- **Typo distance** — the Levenshtein distance between two normalised names.
- **Near duplicate** — an existing item whose normalised name equals the typed normalised name, or whose typo distance is at most the allowance for that name's length: 1 for a normalised name of 5 to 9 characters, 2 for 10 or more, 0 below 5. Short names (fewer than 5 characters) are only compared for equality, because one changed letter in a short name is as likely to be a different product as a typo.
- **Active item** — a `stock_items` row with `archived_at is null`. The warning compares against the organisation's active items only: an archived item is not in the working item master, and the setup list hides it by default, so a warning naming a row the person cannot see would be a dead end.

## Requirements (EARS)

**The warning**
- FR-NDI-001 When a person types a name of at least 3 normalised characters into the **new stock item** form, the form shall compare the normalised name with the organisation's active item names and show the near duplicates it finds.
- FR-NDI-002 The warning shall list at most 3 matches, closest first (equal normalised name before a typo match; then smaller typo distance; then the item code), each with the item code, its name and a link to that item's stock ledger (`/stock/ledger?item=<id>`).
- FR-NDI-003 The warning shall be advisory: it shall not disable the create button, add a field error, change the submitted payload, or cause the database to refuse the write. A person may create the item with the warning showing.
- FR-NDI-004 The warning shall be announced politely (`role="status"`, not `alert`) and its links shall be reachable by keyboard, in reading order after the name field.
- FR-NDI-005 While a name is being edited on an existing item, the form shall show no near-duplicate warning; the ticket's subject is creating an item.
- FR-NDI-006 If the page's item list failed to load, the form shall say the check could not run rather than showing silence; it shall not claim there are no near duplicates.

**Data and scope**
- FR-NDI-010 The comparison shall use the item list the Setup page already holds for the Items tab; it shall issue no extra read and no new write.
- FR-NDI-011 The comparison shall be organisation-scoped by construction: it only sees the rows the caller's RLS-scoped item read returned.
- FR-NDI-012 The warning shall add no table, column, function, policy or setting.

## Non-functional requirements
- NFR-NDI-001 English and Bahasa Indonesia strings in the existing `stock` locale namespace.
- NFR-NDI-002 `DESIGN.md` tokens only for the notice; usable at 320 CSS pixels and on desktop, no fixed width, and no colour-only meaning (the words carry the warning).
- NFR-NDI-003 The comparison runs on each name change against an index normalised once per item list, so a large item master does not re-normalise on every keystroke; a bounded distance stops early.
- NFR-NDI-004 Changing the name field alone must not re-render the item table (memoised index and matches).

## Acceptance criteria and owning layer

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-NDI-001 | Given items "Cement 50 kg" and "Steel bar 12 mm", when the person types `cement 50kg` in the new item form, then a warning lists "Cement 50 kg" and the create button stays enabled. | RTL (`pages/stock/StockSetup.nearDuplicate.test.tsx`) |
| AC-NDI-002 | Given the item "Cement 50 kg", when the person types `Cemnet 50 kg` (a transposed pair), then the warning lists "Cement 50 kg" as a typo match. | Unit (`src/lib/stockSimilarity.test.ts`) |
| AC-NDI-003 | Given active "Cement 50 kg" and archived "Cement 50 kgs", when the person types `Cement 50 kg`, then only the active item is listed. | Unit (`src/lib/stockSimilarity.test.ts`) |
| AC-NDI-004 | Given a name shorter than 3 normalised characters or one with no close match, when it is typed, then no warning appears and no field error is added. | Unit (`src/lib/stockSimilarity.test.ts`) |
| AC-NDI-005 | Given a warning is showing, when the person submits the form, then the item is created with the typed values and the warning never blocked it. | RTL (`pages/stock/StockSetup.nearDuplicate.test.tsx`) |
| AC-NDI-006 | Given the item list could not be loaded, when the new item form opens, then it says the check could not run and the create button is still available. | RTL (`pages/stock/StockSetup.nearDuplicate.test.tsx`) |
| AC-NDI-007 | Given the warning lists two matches, when it renders, then each is a link to `/stock/ledger?item=<id>` with the code and name as its accessible text, inside a `role="status"` region. | RTL (`pages/stock/StockSetup.nearDuplicate.test.tsx`) |
| AC-NDI-008 | Given an existing item in the edit form, when its name is changed to match another item, then no near-duplicate warning is shown. | RTL (`pages/stock/StockSetup.nearDuplicate.test.tsx`) |
| AC-NDI-009 | Given the shipped `id` catalogue, when the new item form shows a near-duplicate warning, then the title, the explanation and the couldn't-check note read in Bahasa Indonesia. | RTL (`pages/stock/StockSetup.nearDuplicate.test.tsx`) |

## Out of scope, restated
No block, no merge, no import warning, no setting, no server-side check, no new migration.
