# Review — #477 locale drift sweep (`fix/477-locale-drift-sweep`)

**Fixed point:** `b4dfe512` (merge-base with `origin/dev`) · **Reviewed:** `890362ce`, `10d2ae98`, `54dc9334`
**Spec source:** issue #477 + `docs/plans/2026-08-19-locale-drift-sweep-afc28bd5.md` + the DD-I18N-* rulings on #468.
**Context:** built by SSSF ADW `afc28bd5` (`fe_builder`). The chain aborted on an envelope parse failure
(#482) before its own review phase, so this battery ran Director-side instead.

Axes reported separately and **not** merged or reranked — the point of the separation.

---

## Spec axis

**Strengths**

- Every swept shape got a named export that **documents the call site it reproduces**, so the seam (#468)
  has an enumerated surface to make locale-aware rather than a guess.
- **Highest-risk mapping verified by reading, not by report.** `RevenueByProject.tsx` carried *two*
  fraction-digit shapes: `minimumFractionDigits: 2` (table cells) and `: 0` (KPI tiles). They map to
  `formatCurrencyCents` and `formatCurrencyAuto` respectively — correct. A swap here would have silently
  changed displayed money.
- **`exportValue` paths left raw** (`row.total_amount.toString()`). DD-I18N-4 holds at the call site, not
  just inside `toWorkbookBuffer` — no formatted string can reach a spreadsheet cell.
- **Exclusion honoured.** `ProjectDetailHeader.tsx:67` logic untouched; a line-scoped `eslint-disable`
  names #468 as its owner.
- **AC traceability intact.** `AC-SC-AXIS-004/005` remain proven by `sCurve.test.ts` and are cited in
  `format.ts`; `formatUtcDayMonthYear` documents *why* it stays `Intl` rather than `date-fns` (date-fns is
  local-tz and would drift the day in behind-UTC zones).

**Issues**

- *Minor —* the brief said "behaviour-preserving / byte-identical". Two deliberate deviations exist. One
  was declared (shape-3 `toLocaleDateString()` → deterministic `en-US`, which is the intended fix). The
  second was **not** declared and is recorded under Quality below.

**Assessment:** conforms. Scope held; nothing implemented that wasn't asked for.

---

## Quality axis

**Strengths**

- Naming is honest and specific (`formatCurrencyCents` / `Auto` / `Fine` say what they do).
- **Duplication collapsed** — the fine-grained cost formatter was verbatim in `AdministrationUsage` and
  `AgentCostMetrics`; now one.
- The guard is **AST-based** (`no-restricted-syntax` selectors), not a regex over source, and it is
  **mutation-proven**: reintroducing each banned form raises its own error and fails lint.

**Issues**

- **Important — sibling money formatters disagreed on negative sign placement.** `formatCurrencyCents` and
  `formatCurrencyFine` used `style: 'currency'` → `-$1,234.50`; `formatCurrencyAuto` welded a `$` onto a
  plain number → `$-1,234.5`. `RevenueByProject` renders **both on one screen** (table cells vs KPI tiles),
  so a negative open-AR balance — reachable on an overpayment or credit note — would show the minus in two
  different places. Also an undeclared behaviour change for `Cents`/`Fine`, whose old welded form put the
  sign inside the symbol.
  **Fixed in review:** `formatCurrencyAuto` now uses `style: 'currency'` with `min 0 / max 3`, which is
  **byte-identical for every positive** (verified across the range) and aligns negatives.
- **Minor — the byte-identity claim was only tested on the happy path.** The new tests asserted positives
  only, so the one input class where byte-identity actually breaks had no coverage. **Fixed in review:**
  added a regression test pinning all three formatters' negative output plus an explicit
  positives-are-byte-identical loop.

**Assessment:** good work with one real inconsistency, found by reading the formatters against each other
rather than individually. Both findings closed on the branch.

---

## Security axis

Right-sized per CLAUDE.md — depth goes to auth/RLS/RPC/public surfaces, and this change touches **none**.

- **Zero** files under `supabase/`, `migrations/`, `auth/`, or `supabase/functions/`. No `.sql`. No policy,
  no RPC, no edge function. The diff is display formatting plus an ESLint config.
- No new input parsing, no new sink, no change to any trust boundary. `parseMoneyInput` is untouched
  (it belongs to #468).
- Positive note: keeping `exportValue` raw removes a path by which a locale-formatted string could enter a
  spreadsheet cell — a data-integrity property, and the reason DD-I18N-4 exists.

**Assessment:** no findings. Confirmed quickly, as the rule provides for.

---

## Design / Discover axis

**Owed, not yet run.** UI changed across ~20 pages (dates and money). The rendered pass should confirm
dates and amounts still read correctly on the affected surfaces — in particular the KPI-tile vs
table-cell money pairing on `RevenueByProject`, which is where the negative-sign inconsistency lived.

---

## Domain gates

| Gate | Result |
|---|---|
| `npm run verify` (8 gates) | **green** on `10d2ae98`; re-run after the review fixes |
| Guard mutation check | **red on reintroduction** (exit 1, one error per selector); exemption proven by the suite passing green with `format.ts` full of `new Intl.*` |
| Coverage on changed lines | new formatters unit-tested individually; call-site changes covered by the existing component suite |
| RLS / migrations / `org_id` | **N/A** — no DB surface touched |

## Decision recorded

The **negative-money rendering changes** from `$-1,234.50` to `-$1,234.50` across all money display. This is
a deliberate, accepted behaviour change: the new form is standard, and consistency between sibling
formatters matters more than preserving the old placement. Logged to `docs/decisions.md`.
