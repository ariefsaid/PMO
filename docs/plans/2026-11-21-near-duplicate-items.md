# Near-duplicate warning on a new stock item — Implementation Plan (#2692)

> Spec: `docs/specs/near-duplicate-items.spec.md`. One Orca worker, one slice. No migration, no server change. Reference slice for patterns: `pmo-portal/pages/Companies.tsx` + `pmo-portal/src/lib/db/companies.ts`; the screen touched is `pmo-portal/pages/stock/StockSetup.tsx`.

## Boundary confirmed against `origin/dev` (21 Nov 2026)

- `stock_items` (0412) already holds `code`, `name`, `unit_id`, `lead_time_days`, `archived_at`, with `org_id` stamped by `stamp_org_id()`. There is no name uniqueness rule and none is proposed; the ticket warns, never blocks.
- The Setup page already reads every item (`useStockItems`) for the Items tab (`StockSetup.tsx`), so the warning compares against a list already in memory. No new read, no write, no RLS surface.
- The new-item form is `MasterFormModal` in `StockSetup.tsx`; the name is a `TextField` bound to `useEntityForm`. The item's canonical link target is `/stock/ledger?item=<id>` (the link `StockOnHand.tsx` uses).
- Import (`makeStockItemImportDescriptor`) has no advisory row state; unchanged here (spec, "Not in this ticket").

## Files

| File | Change |
|---|---|
| `pmo-portal/src/lib/stockSimilarity.ts` | New: pure normalisation, bounded typo distance, index and finder. |
| `pmo-portal/src/lib/stockSimilarity.test.ts` | New: unit tests for AC-NDI-002, 003, 004 and the ordering/cap rules. |
| `pmo-portal/src/components/stock/SimilarItemNotice.tsx` | New: advisory notice, `role="status"`, links to the ledger, tokens only. |
| `pmo-portal/pages/stock/StockSetup.tsx` | Wire the index and the notice into the **new item** form only; pass the list's load state. |
| `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` | New RTL journey for AC-NDI-001, 005, 006, 007, 008, 009. |
| `pmo-portal/public/locales/en/stock.json`, `.../id/stock.json` | Four new keys under `setup.form.item.similar`. |
| `pmo-portal/test/bahasa.tsx` | Add the `stock` namespace so the Bahasa test reads the shipped catalogue. |
| `docs/glossary.md` | Add **Near duplicate** (stock item). |

No file under `supabase/` changes. No new setting, no feature flag.

## Slice 1 — pure rule (red first)

- [ ] `pmo-portal/src/lib/stockSimilarity.test.ts` first (RED), then `pmo-portal/src/lib/stockSimilarity.ts`:
  - `normalizeStockName(raw)` — NFD, strip combining marks, lowercase, drop everything not `[a-z0-9]`. `'Cement 50 kg'`, `'CEMENT-50KG'`, `'cemént 50kg'` → `cement50kg`.
  - `typoAllowance(length)` — `0` below 5, `1` for 5–9, `2` for 10+.
  - `withinDistance(a, b, allowed)` — bounded Levenshtein, early exit; no library.
  - `indexStockItems(items)` — `{ id, code, name, key }` with `archived_at` rows dropped.
  - `findNearDuplicateItems(rawName, index, limit = 3)` — no result below 3 normalised characters; equal key first, then distance, then code; at most `limit`.
- [ ] Cases that must be red before the code exists: case/space/punctuation/accent equality (AC-NDI-001 unit half), transposition inside the allowance (AC-NDI-002), "Cat" vs "Car" **not** matched (short-name rule), archived row excluded (AC-NDI-003), blank and 2-character input (AC-NDI-004), a 20-item list capped at 3 in determinism order.

## Slice 2 — notice and wiring

- [ ] `SimilarItemNotice` renders `null` for no matches; otherwise a `role="status"` block using `border-warning/40 bg-warning/12` and `text-warning-foreground` (the `GateNotice` amber pair, AA), the `alert` icon, a title, one sentence saying the person can still create the item, and a `<ul>` of `<Link to={'/stock/ledger?item=' + id} target="_blank" rel="noreferrer">` with `code · name`. Keyboard-reachable, `touch-target` sizing.
- [ ] `StockSetup.tsx`: `const allItemIndex = useMemo(() => indexStockItems(allItems.data ?? []), [allItems.data])` where `allItems = useStockItems(true)` and the archive filter lives in `indexStockItems`; the modal receives `existingItems={allItems}` and `matches` computed by `useMemo` on the name value. Gate on `!isEdit && which === 'items'`.
- [ ] Load state: all items `isError` → the muted couldn't-check note; `isPending` → nothing (transient); success → the matches (possibly none).
- [ ] RTL journeys (new file, the existing `StockSetup.test.tsx` is untouched): open New item, type a near-duplicate, assert the notice, the href, the enabled submit, create and assert the payload is the typed values, edit-mode silence, failed-list note, and the Bahasa render.

## Slice 3 — copy and gates

- [ ] `stock.json` keys, EN and ID, same shape:
  - `setup.form.item.similar.title` — "A similar item already exists" / "Barang serupa sudah ada"
  - `setup.form.item.similar.body` — "Check it before adding a duplicate. You can still create this one." / "Periksa dulu sebelum menambah duplikat. Barang ini tetap bisa dibuat."
  - `setup.form.item.similar.checkUnavailable` — "Could not check existing item names. You can still create this one." / "Tidak bisa memeriksa nama barang yang sudah ada. Barang ini tetap bisa dibuat."
  - `setup.form.item.similar.listLabel` — "Similar items" / "Barang serupa"
- [ ] `node scripts/check-i18n-namespaces.mjs` (inside `check:guards`) proves EN/ID parity.
- [ ] `scripts/ux-proof.sh /stock/setup` — the route renders without a database change; the notice itself is asserted by the RTL tests, since it only appears with seeded near-duplicates and an open dialog.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-NDI-001 | RTL | `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` |
| AC-NDI-002 | Unit | `pmo-portal/src/lib/stockSimilarity.test.ts` |
| AC-NDI-003 | Unit | `pmo-portal/src/lib/stockSimilarity.test.ts` |
| AC-NDI-004 | Unit | `pmo-portal/src/lib/stockSimilarity.test.ts` |
| AC-NDI-005 | RTL | `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` |
| AC-NDI-006 | RTL | `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` |
| AC-NDI-007 | RTL | `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` |
| AC-NDI-008 | RTL | `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` |
| AC-NDI-009 | RTL | `pmo-portal/pages/stock/StockSetup.nearDuplicate.test.tsx` |

## Final gate

`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, `npx vitest related --run <touched source files>`. No database gate: nothing under `supabase/` changes. No e2e: the warning is a form-local advisory, proven at the RTL layer (ADR-0010 lowest sufficient layer).
