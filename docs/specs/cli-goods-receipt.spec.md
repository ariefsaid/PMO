# Spec: CLI goods-receipt capture — `pmo purchases receive` (issue #1866)

> **Status:** Built — 2026-11-06 (fix round applied 2026-11-06 after review). Runbook:
> `docs/runbooks/pmo-cli.md` § Purchases. Code: `scripts/pmo.mjs` (`receive`), `scripts/lib/pmo-receipts.mjs`.
>
> **Scope:** one CLI command that records a goods receipt through the already-served
> `adapter-dispatch` surface (domain `procurement`, `operation create`, `erp_doc_kind goods-receipt`) —
> the same command the app's Record goods receipt form sends. **Out of scope:** new edge functions, new
> tables, cancelling/reversing a receipt. Slice B (migration 0702) adds `create_procurement_receipt` to the API-client
> guard for Admin and Project Manager, so a PMO-owned (no-ERP) organisation can receive from the CLI.

## 1. Job story

When I am operating PMO for a client from a terminal and goods arrive against a purchase order, I want to
record the receipt as myself, so the ERP ledger and the PMO purchase show what actually arrived without
anyone retyping it in the app.

## 2. Functional requirements (EARS)

- **FR-RCV-001** The CLI shall send the goods receipt as the app does: one `adapter-dispatch` command
  whose PMO record id and idempotency key are the **same** intent uuid, so a retry never double-records.
- **FR-RCV-002** Where the caller gives no `--line`, the CLI shall send a whole-purchase receipt (no
  caller lines) and the server shall receive everything still open.
- **FR-RCV-003** Where the caller gives `--line <item>=<quantity>` and the organisation is on the
  **Odoo** tier with the Full plan, the CLI shall send those lines as `receiptLines`; the server keeps the
  entitlement check and the open-quantity rules.
- **FR-RCV-004** If the caller gives `--line` on any other tier, the CLI shall refuse with exit 2 and
  send nothing, because that tier's receipt is built from the purchase order and would receive the whole
  purchase rather than the quantities asked for.
- **FR-RCV-005** If the organisation records purchases in PMO (no connected accounting system), the CLI
  shall record a whole-purchase receipt through `create_procurement_receipt` (intent as import batch id) and
  refuse `--line` with exit 2; the guard admits Admin and Project Manager only.
- **FR-RCV-006** The CLI shall validate every input (purchase id, lines, status, date, intent) before any
  request, and exit 2 with nothing sent when any is invalid — including a calendar date that does not
  exist.
- **FR-RCV-007** The CLI shall print the intent uuid **before** dispatching, so a run that hangs still
  leaves the id to retry with, and shall attach it to every post-dispatch refusal.
- **FR-RCV-008** The CLI shall explain every shipped server refusal with an actionable hint, keyed on the
  refusal code where the message does not carry the reason (pre-cutover).

## 3. Acceptance criteria (Given/When/Then)

- **AC-RCV-001** Given a purchase on a connected org, when the user receives it whole, then the CLI sends
  the app's goods-receipt command, with the one intent as both record id and idempotency key.
- **AC-RCV-002** Given `--line Pump=3 --line Valve=1.5`, when the user runs the command on an Odoo-tier
  org, then the command carries exactly those item/quantity pairs and defaults to status `Partial`.
- **AC-RCV-003** Given no `--intent`, when the user receives, then a fresh uuid is minted and printed, and
  re-running with it sends the identical identity.
- **AC-RCV-004** Given a PMO-owned purchase, when the user receives, then the CLI records the whole-purchase
  receipt through `create_procurement_receipt` (no dispatch); `--line` there is refused with exit 2.
- **AC-RCV-013** Given a CLI token, when it calls `create_procurement_receipt`, then the guard admits an active
  Admin or Project Manager only, and the RPC refuses another organisation's purchase and a repeated intent.
- **AC-RCV-005** Given the Full plan is off, when the user sends `--line`, then the server's "require
  procurement full" refusal returns with an actionable hint and the intent to reuse.
- **AC-RCV-006** Given a line quantity above what is open, when the user receives, then the refusal names
  the line and carries a hint about the open quantity.
- **AC-RCV-007** Given a wrong-state purchase (nothing open, no sent purchase order, ordered before the
  connection) or an unreachable ERP, when the user receives, then each refusal carries its hint, and the
  unreachable one says to re-run with the same `--intent`.
- **AC-RCV-008** Given `--dry-run`, when the user receives, then nothing is dispatched and the exact
  command is printed.
- **AC-RCV-009** Given malformed input (no id, non-uuid id, bad/duplicate/zero line, unknown status,
  malformed date, bad intent), when the user receives, then every case exits 2 with zero requests.
- **AC-RCV-010** Given an org on a tier whose receipt takes no per-line quantities (or an unrecognised
  tier), when the user passes `--line`, then the CLI refuses with exit 2, an actionable hint and no
  dispatch; a whole-purchase receipt on that tier still works.
- **AC-RCV-011** Given an impossible calendar date (`2026-02-30`, `2026-11-31`, `2026-13-01`), when the
  user receives, then it is refused with exit 2 before any request; a real date (including a leap day)
  passes.
- **AC-RCV-012** Given a receipt about to be sent, when dispatch is entered, then the intent uuid has
  already been printed to stderr.

## 4. Traceability

| AC | Owning layer | Owning test (`node --test scripts/pmo-receipts.test.mjs`) |
|---|---|---|
| AC-RCV-001 | Unit | `AC-RCV-001 whole-purchase receipt sends the app's goods-receipt command…` |
| AC-RCV-002 | Unit | `AC-RCV-002 line-level receipt carries itemRef/quantity lines…` |
| AC-RCV-003 | Unit | `AC-RCV-003 without --intent a fresh one is minted and printed…` |
| AC-RCV-004 | Unit | `AC-RCV-004 a purchase PMO owns is received through create_procurement_receipt…` |
| AC-RCV-013 | pgTAP | `supabase/tests/1866_cli_native_receipt_guard.test.sql` |
| AC-RCV-005 | Unit | `AC-RCV-005 plan off: the server refusal gets an actionable hint…` |
| AC-RCV-006 | Unit | `AC-RCV-006 quantity over what is open is refused…` |
| AC-RCV-007 | Unit | `AC-RCV-007 wrong state (nothing open / no order / pre-cutover)…` |
| AC-RCV-008 | Unit | `AC-RCV-008 --dry-run sends nothing and prints the command` |
| AC-RCV-009 | Unit | `AC-RCV-009 bad input is refused before anything is sent`, `… parseLineFlags splits on the last =`, `… isReceiptDate accepts real calendar days only` |
| AC-RCV-010 | Unit | `AC-RCV-010 --line is refused on a tier whose receipt command takes no per-line quantities…`, `AC-RCV-010 receiptLineTierRefusal admits only the tier…` |
| AC-RCV-011 | Unit | `AC-RCV-011 an impossible calendar date is refused before anything is sent…` |
| AC-RCV-012 | Unit | `AC-RCV-012 the intent is printed before the receipt is sent…` |

Every AC is decided in the CLI, so the lowest sufficient layer is the unit suite above. The rules the CLI
only *reports* stay the server's: the Full-plan entitlement (`receiptLineGuard.ts`, proven by
`supabase/functions/adapter-dispatch/receiptLines.served.test.ts`), the open-quantity plan, and the
pre-cutover gate are not re-implemented here, and the CLI's ownership read is UX only — the server
re-derives role, tier and ownership.

## 5. Known gaps

- A PMO-only organisation's receipt is whole-purchase only; a purchase's requester who is neither Admin nor Project Manager receives in the app.
- `--line` is Odoo-tier only. The ERPNext receipt keys caller lines on `record.items`, a different shape
  this command does not build; supporting it is a separate change, and until then line-level receipts on
  an ERPNext org are entered in the app (AC-RCV-010).
- The default receipt date is today in UTC: the CLI has no cheap read of the organisation's time zone, so
  an operator in another zone passes `--date` for the local business date (documented in the runbook).
