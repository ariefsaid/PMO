# Movements awaiting proof: Implementation Plan (#2689)

Spec: `docs/specs/stock-movements-awaiting-proof.spec.md`. Stacked on #2690. Not a money path. **Migrations: none** (1325 to 1329 reserved, unused).

## Reuse (do not re-derive)
- Read: `getMovementProofStatus` (`pmo-portal/src/lib/db/stockTransfers.ts`) via `repositories.stockTransfers.proofStatus`; hook `useProofStatus`
  (`src/hooks/useStockTransfers.ts`); setting hook `useTransferSettings` (`proofTiming`); keepers `useStockKeepers` (`src/hooks/useStock.ts`);
  real role `useEffectiveRole`; warehouse names come back in the row.
- Style: the Transfers list cards (`pages/stock/StockTransfers.tsx`), `DESIGN.md` tokens, shared `Button`.

## Files
1. **`pmo-portal/src/components/stock/ProofChaseCard.tsx`** (new). Props none. Reads `useTransferSettings`, `useStockKeepers`, `useAuth`,
   `useEffectiveRole`, and `useProofStatus('outstanding')` with a new `enabled` argument. Returns null unless timing is `may_follow`, the person is
   Admin (real role) or a keeper, and the filtered list is non-empty. Sorts by `movementDate`, `number` ascending; `daysWaiting = max(0, today - date)`
   using calendar days (UTC-safe date-only parse). Renders `<section aria-label>` with heading, "Updated HH:MM" from `dataUpdatedAt`, a `<ul>` of
   `<Link>` rows (number, `from -> to`, date, days waiting, missing words) and a Show all / Show fewer button after five.
   Pure helpers `daysWaiting`, `missingWords` exported for tests.
2. **`pmo-portal/src/hooks/useStockTransfers.ts`**: `useProofStatus(status, enabled = true)`; `enabled: Boolean(orgId) && enabled`; add `refetchOnWindowFocus: true`
   (the query client default may be off; set explicitly). Existing call sites unchanged.
3. **`pmo-portal/pages/stock/StockOnHand.tsx`**: render `<ProofChaseCard />` between `<StockTabs />` and `<StockFilters>`. No other change.
4. **`pmo-portal/pages/stock/StockDocumentAttachments.tsx`**: after a successful attach or archive, invalidate `['stock-proof-status']` (find the existing
   success handler; one line) so the card leaves the list without waiting for focus. (Verify first; skip if it already invalidates.)
5. **`pmo-portal/public/locales/en/stock.json` and `.../id/stock.json`**: new keys under `proof.chase`: `title` ("Waiting for proof ({{count}})"), `updated`
   ("Updated {{time}}"), `waiting_one` / `waiting_other` ("waiting {{count}} day" / "days"), `missing` ("Missing: {{what}}"), `showAll` ("Show all {{count}}"),
   `showFewer` ("Show fewer"), `go` ("Add proof"). Missing words reuse `proof.rule.*`. Bahasa Indonesia written natively ("Menunggu bukti", "menunggu {{count}} hari").
   Run `scripts/i18n` parity checks via `npm run check:guards`.
6. **Glossary** `docs/glossary.md`: add **Proof chase list** next to *Proof rule*.

## Tests (write first)
| AC | Layer | File |
|---|---|---|
| AC-MAP-001..010 | unit (Vitest/RTL, mocked repository and hooks) | `pmo-portal/src/components/stock/ProofChaseCard.test.tsx` |
| AC-MAP-002, 003 (page unchanged) | unit | add `pmo-portal/pages/stock/StockOnHand.proofChase.test.tsx` (new file; existing StockOnHand tests untouched) |
| AC-MAP-011 | e2e (one curated journey) | `pmo-portal/e2e/AC-MAP-011-chase-list-clears-on-attach.spec.ts` (class per `docs/e2e-parallel-conventions.md`; seeds via the same helpers as the 2690 specs) |
| AC-MAP-012 | pgTAP (existing 1309) | no new file |

Tests assert user actions and text, never looks. Written but not run for e2e; unit run per the gate change.

## Gates (the GATE CHANGE set)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest run <new and touched test files>`; no DB, e2e or screenshots.

## Risks and notes
- Tenancy and role are the database's (1309 read is org-scoped; attach is `stock_can_attach`); the page filter is UX only.
- `before_posting` orgs: card null, read skipped for non-keepers; a keeper's read still runs (one cheap request). To avoid even that, gate `enabled` on
  `proofTiming === 'may_follow'` too (do this: settings read first, then the proof read).
