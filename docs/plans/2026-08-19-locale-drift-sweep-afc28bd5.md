# Plan — Issue #477: Locale drift sweep (~45 hardcoded-locale format sites → `format.ts`)

- **Date:** 2026-08-19 · **Issue:** [#477](https://github.com/ariefsaid/PMO/issues/477) (graduated from #468, `DD-I18N-*`)
- **Worktree:** `.claude/worktrees/477-locale-sweep` (work here only) · **Branch:** `fix/477-locale-drift-sweep` off `dev` · **Do not push / open a PR.**
- **Type:** behavior-preserving refactor + ESLint guard. **No locale awareness is added** — that is #468.
- **Commands** run from `pmo-portal/`. Heavy suite via `npm run verify:locked` (shared machine).

## Goal

Every number/date/money display routes through `pmo-portal/src/lib/format.ts`. Today 27 call-site
lines across 22 production files call `toLocaleString` / `toLocaleDateString` / `new Intl.*` with a
hardcoded or implicit locale. After the sweep the locale seam (#468) changes ONE file instead of 28.

## Hard constraints (binding)

1. **Byte-identical output.** Every site renders the same string as before (in an `en-US` browser —
   the app's only current locale). Where a site's shape differs from an existing `format.ts` export,
   add a **new named export** reproducing that exact shape. Never "harmonise".
2. **EXCLUDE `pages/project-detail/ProjectDetailHeader.tsx:67`** — masked money *input*, owned by
   #468. It keeps its `toLocaleString('en-US')` behind a line-scoped lint disable.
3. **Do not touch `src/lib/export/**`** (typed cells, `DD-I18N-4`). No export value passes through a
   formatter.
4. **Leave e2e/test files alone.** No test asserts output that changes (nothing should change).
5. No i18n library, no new dependencies.
6. Guard lands **after** the sweep (else `lint:ci` is red across 22 files mid-build).

## Verified survey (from the live tree — matches the issue exactly)

Production sites: `components/ProjectCalendarView.tsx:268` · `pages/AdministrationCredits.tsx:54,117` ·
`pages/AdministrationUsage.tsx:21-28,85,89,96,100,102` · `pages/Approvals.tsx:58` ·
`pages/CompanyDetail.tsx:539-540` · `pages/ContactDetail.tsx:303-304` · `pages/IncomingPayments.tsx:81,187,195` ·
`pages/RevenueByProject.tsx:92,103,138,146,154,162` · `pages/SalesInvoices.tsx:176,188,197,205` ·
`pages/Timesheets.tsx:152,426-431,594` · `pages/procurement/ProcurementLedger.tsx:51-55` ·
`pages/procurement/ProcurementProgressionTimeline.tsx:37-42` · `pages/project-detail/MilestoneStrip.tsx:279` ·
`pages/project-detail/PipelineLens.tsx:165` · `pages/timesheets/ApprovalsQueue.tsx:33,56` ·
`src/components/AccountingSnapshotProvenance.tsx:30-31` · `src/components/admin/AgentCostMetrics.tsx:57-64,104,108,147-152` ·
`src/components/integrations/IntegrationsView.tsx:300,313,332` · `src/components/milestones/MilestonePhaseHeader.tsx:22-23` ·
`src/components/ui/EntryList.tsx:16` · `src/lib/calendar/monthMatrix.ts:50-53` · `src/lib/delivery/sCurve.ts:116-131`.

Allowed to remain after the sweep: `src/lib/format.ts` (the seam), `src/lib/export/**` (no current
hits; forward-looking exemption), `ProjectDetailHeader.tsx:67`, and test files
(`e2e/serial/AC-TSP-011-timesheet-push.spec.ts:40`, `pages/project-detail/__tests__/ProjectDetailHeader.dateTz.test.tsx:4` (comment), `src/components/ui/__tests__/HoursBar.test.tsx:65`).

## Design — `format.ts` named exports

16 new exports (5 money, 11 date). Every expected string below was **verified against this machine's
ICU** (node 22, full-icu), not guessed. All date exports take a `Date` (call sites already construct
them; construction stays put — only formatting centralises). All are deterministic `en-US`/`en-GB`
today; #468 swaps the locale inside this one file.

Byte-identity rationale (the two non-obvious cases):

- **`formatCurrencyCents`** replaces `` `$${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}` ``
  (plain-number min-2/max-3 + welded `$`). DB money columns are `numeric(14,2)`
  (`sales_invoices.total_amount`, `erp_outstanding_amount` ×2 in migrations 0100/0123), so reachable
  values have ≤2 decimals and min2/max2 currency style renders the identical string (`$1,234.50`;
  float dust from client-side sums rounds away identically at max2 and max3).
  ⚑ **One flagged micro-delta:** for a *negative* value the old welded form rendered `$-1,234.50`,
  currency style renders `-$1,234.50`. These columns are validated ≥0 amounts; a negative is
  data-anomalous, unasserted by any test. Flagged for the Director — if negatives are deemed
  reachable, swap the impl to `'$' + plain-min2 formatter` (one line, still byte-identical for ≥0).
- **`formatDateNumeric`** replaces bare `.toLocaleDateString()`: explicit
  `{month:'numeric',day:'numeric',year:'numeric'}` in `en-US` is the locale's default pattern —
  verified identical (`6/14/2026`), and it kills the viewer-browser dependency (the latent bug).

### Code to append to `pmo-portal/src/lib/format.ts`

```ts
// ── #477 locale-drift sweep: named formatters for every display shape the app renders ──────
// Each export reproduces byte-identically what previously lived as a hardcoded/implicit-locale
// call at a call site. The locale seam (#468) will make these org/user-aware in ONE file.

// Money — cents-exact ERP amounts (numeric(14,2)): "$1,234.50".
const currencyCentsFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatCurrencyCents(value: number): string {
  return currencyCentsFormatter.format(value);
}

// Money — default-fraction values (KPI tiles): "$1,234" / "$1,234.5" / "$1,234.56" (0–3 dp, no padding).
const numberDefaultFormatter = new Intl.NumberFormat('en-US');
export function formatCurrencyAuto(value: number): string {
  return `$${numberDefaultFormatter.format(value)}`;
}

// Money — fine-grained agent/provider costs (sub-$1): "$0.0123" (2–4 dp).
// Was duplicated verbatim in AdministrationUsage + AgentCostMetrics.
const currencyFineFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export function formatCurrencyFine(value: number): string {
  return currencyFineFormatter.format(value);
}

// Plain grouped number (counts, tokens): "1,234,567". Replaces bare n.toLocaleString().
export function formatNumber(value: number): string {
  return numberDefaultFormatter.format(value);
}

// Number with at most 2 fraction digits (credits balance): "1,234.57".
const numberMax2Formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export function formatNumberMax2(value: number): string {
  return numberMax2Formatter.format(value);
}

// ── Date display variants (all Date-in; construction stays at call sites) ──────────────────

/** "Jun 14" — short month + day. */
const monthDayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
export function formatMonthDay(d: Date): string {
  return monthDayFormatter.format(d);
}

/** "Sun" — short weekday (timesheet grid columns). */
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
export function formatWeekday(d: Date): string {
  return weekdayFormatter.format(d);
}

/** "Jun 14, 2026" — Date-input twin of formatDate(iso) (same parts, local zone; shares its formatter). */
export function formatFullDate(d: Date): string {
  return dateFormatter.format(d);
}

/** "Jun 14, 2026, 03:45 PM" — last-sync style (hour '2-digit' is zero-padded). */
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export function formatDateTime(d: Date): string {
  return dateTimeFormatter.format(d);
}

/** "6/14/2026" — numeric M/D/YYYY; byte-identical to bare toLocaleDateString() in en-US. */
const dateNumericFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
});
export function formatDateNumeric(d: Date): string {
  return dateNumericFormatter.format(d);
}

/** "June 2026" — long month + year (calendar header). */
const monthYearFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
export function formatMonthYear(d: Date): string {
  return monthYearFormatter.format(d);
}

/** "Sun, Jun 14" — calendar agenda day heading. */
const weekdayMonthDayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
export function formatWeekdayMonthDay(d: Date): string {
  return weekdayMonthDayFormatter.format(d);
}

/** UTC "Jun 14, 2026" — zone-stable business dates (a 23:00Z instant must not drift a day). */
const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
export function formatDateUtc(d: Date): string {
  return utcDateFormatter.format(d);
}

/** en-GB "14 Jun" — milestone target chips. */
const dayMonthFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
export function formatDayMonth(d: Date): string {
  return dayMonthFormatter.format(d);
}

/** UTC "Jun 26" — monthly chart axis ticks. */
const utcMonthYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
export function formatUtcMonthYear(d: Date): string {
  return utcMonthYearFormatter.format(d);
}

/** UTC "15 Mar '25" — S-curve axis: en-GB day-month + quoted 2-digit year (AC-SC-AXIS-004/005).
 *  formatToParts + manual join so the apostrophe is explicit; stays Intl (not date-fns format)
 *  because date-fns is LOCAL-tz and would drift the day in behind-UTC zones. */
const utcDayMonthYearFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
export function formatUtcDayMonthYear(d: Date): string {
  const parts = utcDayMonthYearFormatter.formatToParts(d);
  const find = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${find('day')} ${find('month')} '${find('year')}`;
}
```

## Design — ESLint guard

Add to `pmo-portal/eslint.config.js`, as a new block **after** the A2 port-isolation block and
**before** the base `{ files: ['**/*.{ts,tsx}'], extends: [...] }` block:

```js
  // ── locale drift guard (#477): display formatting lives ONLY in src/lib/format.ts ──
  // toLocaleString / toLocaleDateString / new Intl.* hardcode or imply a locale and bypass the
  // single formatting seam (#468). Exempt: format.ts itself (the seam), the export path (typed
  // cells, DD-I18N-4 — a formatted string in a spreadsheet cell corrupts data), and tests.
  // ProjectDetailHeader.tsx:67 (masked money input, owned by #468) carries a line-scoped disable.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/lib/format.ts',
      'src/lib/export/**',
      'e2e/**',
      '**/__tests__/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^toLocale(String|DateString|TimeString)$/]',
          message:
            'Locale-sensitive display formatting bypasses src/lib/format.ts (single formatting seam, #468/#477). Import a formatter from src/lib/format instead.',
        },
        {
          selector: "NewExpression[callee.object.name='Intl']",
          message:
            'Construct Intl formatters only in src/lib/format.ts (single formatting seam, #468/#477). Import a formatter from src/lib/format instead.',
        },
      ],
    },
  },
```

`toLocaleTimeString` is included proactively (zero hits today — verified) to close the same drift
class. `localeCompare` (Timesheets:145) is sorting, not display — not matched by the selector.

And in `pages/project-detail/ProjectDetailHeader.tsx`, line 67 becomes (comment-only change, zero
behavior delta):

```ts
  // eslint-disable-next-line no-restricted-syntax -- masked money INPUT, not display; owned by the #468 locale seam (excluded from the #477 sweep)
  const grouped = intPart ? Number(intPart).toLocaleString('en-US') : '';
```

## Tasks

TDD-first: Tasks 1–4 are the red/green cycle for the new exports. Tasks 5–18 are mechanical
byte-identical call-site rewrites whose oracle is the existing suite (net listed under
Traceability). Task 19 adds the guard, Task 20 is its mutation check, Task 21 is the full gate.

### Task 0 — Branch

```bash
cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/477-locale-sweep
git checkout dev && git pull --ff-only && git checkout -b fix/477-locale-drift-sweep
```
(If the worktree is already on an issue branch off a fresh `dev`, branch from it instead — do not
rebase over sibling work. Verify: `git status` clean.)

### Task 1 — RED: money-export tests (`AC-477-01`)

`pmo-portal/src/lib/format.test.ts` — extend the import at line 2 and append:

```ts
import {
  formatCurrency, parseMoneyInput, pct, formatDate, formatRelativeTime,
  formatCurrencyAuto, formatCurrencyCents, formatCurrencyFine, formatNumber, formatNumberMax2,
} from './format';

// ── #477 locale-drift sweep: byte-identical named variants for every swept call-site shape ──

describe('formatCurrencyCents — ERP money, always 2 dp (#477)', () => {
  it('pads to cents and groups: $1,234.50', () => {
    expect(formatCurrencyCents(1234.5)).toBe('$1,234.50');
    expect(formatCurrencyCents(0)).toBe('$0.00');
    expect(formatCurrencyCents(2500)).toBe('$2,500.00');
  });
  it('byte-identical to the swept welded-$ min-2dp form on numeric(14,2) data', () => {
    expect(`$${(1234.5).toLocaleString('en-US', { minimumFractionDigits: 2 })}`).toBe(
      formatCurrencyCents(1234.5),
    );
  });
});

describe('formatCurrencyAuto — default-fraction KPI money (#477)', () => {
  it('renders 0–3 fraction digits with no padding: $1,234 / $1,234.5 / $1,234.56', () => {
    expect(formatCurrencyAuto(1234)).toBe('$1,234');
    expect(formatCurrencyAuto(1234.5)).toBe('$1,234.5');
    expect(formatCurrencyAuto(1234.56)).toBe('$1,234.56');
    expect(formatCurrencyAuto(1234567.89)).toBe('$1,234,567.89');
  });
});

describe('formatCurrencyFine — sub-$1 agent/provider costs (#477)', () => {
  it('keeps 2–4 fraction digits: $0.50 / $0.0123 / $12.3456', () => {
    expect(formatCurrencyFine(0.5)).toBe('$0.50');
    expect(formatCurrencyFine(0.0123)).toBe('$0.0123');
    expect(formatCurrencyFine(12.3456)).toBe('$12.3456');
  });
});

describe('formatNumber — plain grouped counts (#477)', () => {
  it('groups thousands like bare toLocaleString in en-US', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatNumberMax2 — credits balance (#477)', () => {
  it('shows at most 2 fraction digits: 1,234 / 1,234.5 / 1,234.57', () => {
    expect(formatNumberMax2(1234)).toBe('1,234');
    expect(formatNumberMax2(1234.5)).toBe('1,234.5');
    expect(formatNumberMax2(1234.567)).toBe('1,234.57');
  });
});
```

Verify (expect RED — the file fails to resolve the new exports):
`cd pmo-portal && npm test -- src/lib/format.test.ts`

### Task 2 — GREEN: money exports (`AC-477-01`)

Append the five money blocks (currencyCents…numberMax2, including `numberDefaultFormatter`) from the
design section to `pmo-portal/src/lib/format.ts`, after `formatCompactCurrency`.
Verify: `npm test -- src/lib/format.test.ts` → green.

### Task 3 — RED: date-export tests (`AC-477-01`)

`pmo-portal/src/lib/format.test.ts` — extend the import with
`formatDateNumeric, formatDateUtc, formatDateTime, formatDayMonth, formatFullDate, formatMonthDay, formatMonthYear, formatUtcDayMonthYear, formatUtcMonthYear, formatWeekday, formatWeekdayMonthDay` and append:

```ts
describe('#477 date variants — all deterministic, TZ-stable (local or UTC-pinned construction)', () => {
  it('formatMonthDay: "Jun 14" / "Jul 4" (no padding)', () => {
    expect(formatMonthDay(new Date(2026, 5, 14))).toBe('Jun 14');
    expect(formatMonthDay(new Date(2026, 6, 4))).toBe('Jul 4');
  });
  it('formatWeekday: "Sun" (2026-06-14 is a Sunday)', () => {
    expect(formatWeekday(new Date(2026, 5, 14))).toBe('Sun');
  });
  it('formatFullDate: "Jun 14, 2026" — same parts as formatDate(iso)', () => {
    expect(formatFullDate(new Date(2026, 5, 14))).toBe('Jun 14, 2026');
  });
  it('formatDateTime: "Jun 14, 2026, 03:45 PM" / midnight "12:00 AM" (hour is 2-digit)', () => {
    expect(formatDateTime(new Date(2026, 5, 14, 15, 45))).toBe('Jun 14, 2026, 03:45 PM');
    expect(formatDateTime(new Date(2026, 5, 14, 0, 0))).toBe('Jun 14, 2026, 12:00 AM');
  });
  it('formatDateNumeric: "6/14/2026" / "7/4/2026" — byte-identical to bare toLocaleDateString in en-US', () => {
    expect(formatDateNumeric(new Date(2026, 5, 14))).toBe('6/14/2026');
    expect(formatDateNumeric(new Date(2026, 6, 4))).toBe('7/4/2026');
  });
  it('formatMonthYear: "June 2026"', () => {
    expect(formatMonthYear(new Date(2026, 5, 1))).toBe('June 2026');
  });
  it('formatWeekdayMonthDay: "Sun, Jun 14"', () => {
    expect(formatWeekdayMonthDay(new Date(2026, 5, 14))).toBe('Sun, Jun 14');
  });
  it('formatDateUtc: zone-stable — a 23:00Z instant is Jun 14 in UTC even where local says Jun 15', () => {
    expect(formatDateUtc(new Date(Date.UTC(2026, 5, 14, 23, 0)))).toBe('Jun 14, 2026');
  });
  it('formatDayMonth: en-GB "14 Jun"', () => {
    expect(formatDayMonth(new Date(2026, 5, 14))).toBe('14 Jun');
  });
  it('formatUtcMonthYear: "Jun 26"', () => {
    expect(formatUtcMonthYear(new Date(Date.UTC(2026, 5, 14)))).toBe('Jun 26');
  });
  it("formatUtcDayMonthYear: \"15 Mar '25\" / \"31 Dec '26\" (quoted 2-digit year, UTC-stable)", () => {
    expect(formatUtcDayMonthYear(new Date(Date.UTC(2025, 2, 15)))).toBe("15 Mar '25");
    expect(formatUtcDayMonthYear(new Date(Date.UTC(2026, 11, 31)))).toBe("31 Dec '26");
  });
});
```

Verify (expect RED): `npm test -- src/lib/format.test.ts`

### Task 4 — GREEN: date exports (`AC-477-01`)

Append the eleven date blocks from the design section to `pmo-portal/src/lib/format.ts`
(`formatFullDate` reuses the existing `dateFormatter` instance).
Verify: `npm test -- src/lib/format.test.ts` → green, and `npm run typecheck`.

### Task 5 — Sweep `pages/RevenueByProject.tsx` (6 sites; `AC-477-01`)

Add import: `import { formatCurrencyAuto, formatCurrencyCents, formatNumber } from '@/src/lib/format';`

| Line | Before → After |
|---|---|
| 92 | `${row.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` (JSX text `$` + `{…}`) → `{formatCurrencyCents(row.total_amount)}` — delete the `$` text node too |
| 103 | same with `row.open_ar` → `{formatCurrencyCents(row.open_ar)}` |
| 138 | `` value={`$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}`} `` → `value={formatCurrencyAuto(totalRevenue)}` |
| 146 | `` value={`$${totalOpenAR.toLocaleString(undefined, { minimumFractionDigits: 0 })}`} `` → `value={formatCurrencyAuto(totalOpenAR)}` |
| 154 | `value={totalInvoices.toLocaleString()}` → `value={formatNumber(totalInvoices)}` |
| 162 | `value={all.filter((r) => r.project_id).length.toLocaleString()}` → `value={formatNumber(all.filter((r) => r.project_id).length)}` |

Verify: `npm run typecheck && npm test -- src/lib/db/revenue.test.ts`

### Task 6 — Sweep `pages/SalesInvoices.tsx` + `pages/IncomingPayments.tsx` (7 sites; `AC-477-01`)

Both files: add `import { formatCurrencyCents, formatDateNumeric } from '@/src/lib/format';`

- SalesInvoices 176: `{inv.amount != null ? `$${inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}` → `{inv.amount != null ? formatCurrencyCents(inv.amount) : '—'}`
- SalesInvoices 188: the `erp_outstanding_amount` twin → `{inv.erp_outstanding_amount != null ? formatCurrencyCents(inv.erp_outstanding_amount) : '—'}`
- SalesInvoices 197: `cell: (inv) => (inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'),` → `cell: (inv) => (inv.invoice_date ? formatDateNumeric(new Date(inv.invoice_date)) : '—'),`
- SalesInvoices 205: `return due ? new Date(due).toLocaleDateString() : '—';` → `return due ? formatDateNumeric(new Date(due)) : '—';`
- IncomingPayments 81: `` ? `$${inv.erp_outstanding_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} outstanding` `` → `` ? `${formatCurrencyCents(inv.erp_outstanding_amount)} outstanding` ``
- IncomingPayments 187: `{p.amount != null ? `$${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}` → `{p.amount != null ? formatCurrencyCents(p.amount) : '—'}`
- IncomingPayments 195: `cell: (p) => (p.date ? new Date(p.date).toLocaleDateString() : '—'),` → `cell: (p) => (p.date ? formatDateNumeric(new Date(p.date)) : '—'),`

(`exportValue` callbacks stay raw `.toString()` — typed export cells, untouched.)
Verify: `npm run typecheck`

### Task 7 — Sweep `pages/Timesheets.tsx` (4 sites; `AC-477-01`)

Add import: `import { formatFullDate, formatMonthDay, formatWeekday } from '@/src/lib/format';`

- 152: `label: d.toLocaleDateString(undefined, { weekday: 'short' }),` → `label: formatWeekday(d),`
- 426-431: the whole `weekRangeLabel` template → `const weekRangeLabel = `${formatMonthDay(weekStartDate)} – ${formatFullDate(weekDates[6])}`;`
- 594: `Week of {weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` → `Week of {formatMonthDay(weekStartDate)}`

Verify: `npm run typecheck && npm test -- src/components/ui/__tests__/timesheet.test.tsx`

### Task 8 — Sweep `pages/Approvals.tsx` + `pages/timesheets/ApprovalsQueue.tsx` (3 sites; `AC-477-01`)

- Approvals line 21 → `import { formatCurrency, formatMonthDay } from '@/src/lib/format';`
- Both files' `weekLabel` (Approvals 58 / ApprovalsQueue 33): `return `Week of ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;` → `return `Week of ${formatMonthDay(dt)}`;`
- ApprovalsQueue: add `import { formatMonthDay, formatWeekday } from '@/src/lib/format';` and line 56 `label: dt.toLocaleDateString(undefined, { weekday: 'short' }),` → `label: formatWeekday(dt),`

Verify: `npm run typecheck && npm test -- src/components/ui/__tests__/ApprovalRow`

### Task 9 — Sweep `CompanyDetail` + `ContactDetail` + `AccountingSnapshotProvenance` (`AC-477-01`)

All three: add `import { formatDate } from '@/src/lib/format';` and keep the local validity guard
(preserves the raw-string fallback for non-ISO input — byte-identical on every input):

```ts
const formatOccurred = (iso: string): string => {   // AccountingSnapshotProvenance: formatAsOf
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDate(iso);
};
```

Files: `pages/CompanyDetail.tsx:539-540` · `pages/ContactDetail.tsx:303-304` ·
`src/components/AccountingSnapshotProvenance.tsx:30-31`.
Verify: `npm run typecheck && npm test -- src/components/dashboard/AccountingSnapshotsSection.test.tsx`

### Task 10 — Sweep `PipelineLens` + `EntryList` (`AC-477-01`)

- `pages/project-detail/PipelineLens.tsx` line 20 → `import { formatCurrency, formatDateNumeric } from '@/src/lib/format';`
  Line 165: `value: project.decided_at ? new Date(project.decided_at).toLocaleDateString() : 'Pending',` → `value: project.decided_at ? formatDateNumeric(new Date(project.decided_at)) : 'Pending',`
- `src/components/ui/EntryList.tsx`: add `import { formatMonthDay } from '@/src/lib/format';`
  Line 16 body → `return formatMonthDay(new Date(`${iso}T00:00:00`));` (keep the try/catch shell).

Verify: `npm run typecheck`

### Task 11 — Sweep milestone chips (`AC-477-01`)

- `pages/project-detail/MilestoneStrip.tsx` line 13 → `import { formatDayMonth, pct } from '@/src/lib/format';`
  Line 279: `` ? `Target ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${milestone.target_date}T00:00:00`))}` `` → `` ? `Target ${formatDayMonth(new Date(`${milestone.target_date}T00:00:00`))}` ``
- `src/components/milestones/MilestonePhaseHeader.tsx` line 2 → `import { formatDayMonth, pct } from '@/src/lib/format';`
  Lines 22-23: same swap on `value`.

Verify: `npm run typecheck`

### Task 12 — Sweep procurement dates (`AC-477-01`)

- `pages/procurement/ProcurementLedger.tsx` line 39 → `import { formatCurrency, formatDateUtc } from '@/src/lib/format';`
  Lines 51-55: `return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });` → `return formatDateUtc(new Date(Date.UTC(y, m - 1, d)));`
- `pages/procurement/ProcurementProgressionTimeline.tsx`: add `import { formatDateUtc } from '@/src/lib/format';`
  Lines 37-42 body → `return formatDateUtc(new Date(iso));` (drop the intermediate `d`).

Verify: `npm run typecheck`

### Task 13 — Sweep `components/ProjectCalendarView.tsx` (`AC-477-01`)

Add `import { formatWeekdayMonthDay } from '@/src/lib/format';`
Lines 268-272: the `new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date)` expression → `const heading = formatWeekdayMonthDay(date);`
Verify: `npm run typecheck && npm test -- src/lib/calendar/monthMatrix.test.ts`

### Task 14 — Sweep admin usage surfaces (`AC-477-01`)

- `pages/AdministrationUsage.tsx`: add `import { formatCurrencyFine, formatNumber } from '@/src/lib/format';`
  - Delete lines 20-28 (the `usdFormatter` const + `formatUsd`); replace its 3 call sites (96, 100, 102) `formatUsd(` → `formatCurrencyFine(`.
  - Line 85: `cell: (r) => r.run_count.toLocaleString()` → `cell: (r) => formatNumber(r.run_count)`
  - Line 89: → `` cell: (r) => `${formatNumber(r.prompt_tokens)} / ${formatNumber(r.completion_tokens)}` ``
- `src/components/admin/AgentCostMetrics.tsx`: add `import { formatCurrencyFine, formatUtcMonthYear } from '@/src/lib/format';`
  - Delete lines 56-64 (`usdFormatter` + `formatUsd`); call sites 104, 108 → `formatCurrencyFine(`.
  - Delete lines 147-151 (`monthAxisFmt`); `formatMonthTick` body → `return formatUtcMonthYear(new Date(epochMs));`

Verify: `npm run typecheck`

### Task 15 — Sweep `pages/AdministrationCredits.tsx` (`AC-477-01`)

Add `import { formatNumberMax2 } from '@/src/lib/format';`
Delete line 54 (`const numberFormatter = …`); line 117 `{numberFormatter.format(balanceQuery.data)}{' '}` → `{formatNumberMax2(balanceQuery.data)}{' '}`.
Verify: `npm run typecheck`

### Task 16 — Sweep `src/components/integrations/IntegrationsView.tsx` (`AC-477-01`)

Add `import { formatDate, formatDateTime } from '@/src/lib/format';`

- 300: `? new Date(binding.connected_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })` → `? formatDate(binding.connected_at)` (ISO-in; same parts, same instant)
- 313: same for `disconnected_at` → `? formatDate(binding.disconnected_at)`
- 332: `? new Date(health.last_sync).toLocaleDateString(undefined, { …, hour: '2-digit', minute: '2-digit' })` → `? formatDateTime(new Date(health.last_sync))`

Verify: `npm run typecheck`

### Task 17 — Sweep `src/lib/calendar/monthMatrix.ts` (`AC-477-01`)

Add `import { formatMonthYear } from '../format';` (after the date-fns import).
Lines 50-53 body → `return formatMonthYear(new Date(year, month, 1));` (keep the doc comment).
Verify: `npm run typecheck && npm test -- src/lib/calendar/monthMatrix.test.ts`

### Task 18 — Sweep `src/lib/delivery/sCurve.ts` (`AC-477-01`)

Add `import { formatUtcDayMonthYear } from '../format';` (after the date-fns import).
Delete lines 116-121 (`axisDateFmt`); `formatSCurveAxisDate` becomes:

```ts
export const formatSCurveAxisDate = (epochMs: number): string => {
  // UTC + en-GB + quoted 2-digit year now live in format.ts (formatUtcDayMonthYear, #477) so the
  // locale seam (#468) can make it locale-aware in one file. Kept as Intl there (not date-fns
  // format) — date-fns is LOCAL-tz and would drift the day in behind-UTC zones (AC-SC-AXIS-004/005).
  return formatUtcDayMonthYear(new Date(epochMs));
};
```

(The exported name/signature is unchanged — its callers and tests stay as-is.)
Verify: `npm run typecheck && npm test -- src/lib/delivery/sCurve.test.ts`

### Task 19 — Add the ESLint guard (`AC-477-02`)

Apply the guard block from the design section to `pmo-portal/eslint.config.js`, and the line-scoped
disable comment to `pages/project-detail/ProjectDetailHeader.tsx:67`.
Verify: `cd pmo-portal && npm run lint:ci` → exit 0 (the sweep left nothing to flag; format.ts,
export path, tests, and the one disabled line are exempt).

### Task 20 — Guard mutation check (binding ritual; `AC-477-03`)

```bash
cd pmo-portal
printf "export const guardProbe1 = (1234).toLocaleString();\nexport const guardProbe2 = new Intl.NumberFormat('en-US');\n" > src/lib/guard-probe.ts
npm run lint:ci; echo "exit=$?"   # MUST be non-zero AND cite no-restricted-syntax (both selectors)
rm src/lib/guard-probe.ts
npm run lint:ci; echo "exit=$?"   # MUST be 0
```

Judge by exit status, not output text. A guard that stays green while violated is not a guard.

### Task 21 — Final gates (`AC-477-02`, `AC-477-04`, `AC-477-05`)

```bash
cd /Users/ariefsaid/Coding/PMO
# AC-477-02 — allowed hits ONLY in format.ts, export/**, ProjectDetailHeader.tsx:67, tests:
grep -rn "toLocaleString\|toLocaleDateString\|new Intl\." pmo-portal --include='*.ts' --include='*.tsx' | grep -v node_modules
# AC-477-04 — no welded-$ next to a formatted number:
grep -rn '\$${' pmo-portal/pages pmo-portal/components pmo-portal/src --include='*.tsx' | grep -v '__tests__' | grep -v '\.test\.'
# AC-477-05 — the WHOLE suite (8+ gates), machine-shared → locked:
cd pmo-portal && npm run verify:locked
```

Expected exact hit set for the first grep: `src/lib/format.ts` (16 `new Intl.` constructor lines),
`pages/project-detail/ProjectDetailHeader.tsx:67`,
`e2e/serial/AC-TSP-011-timesheet-push.spec.ts:40`,
`pages/project-detail/__tests__/ProjectDetailHeader.dateTz.test.tsx:4` (comment),
`src/components/ui/__tests__/HoursBar.test.tsx:65` — nothing else.
The welded-`$` grep must return zero money hits (remaining `` `$ `` templates are non-money labels
and formatter-internal strings in `format.ts` itself).

Advised (not gating for a dev-branch PR, but these specs assert the swept strings): with the local
stack up, `scripts/with-db-lock.sh npm run e2e -- e2e/serial/AC-SAR-040-sales-invoice.spec.ts`
(byte-identical output ⇒ unchanged assertions ⇒ green).

## Traceability

The issue carries no `AC-###` ids (it is build-work graduated from #468's `DD-I18N-*` decisions), so
this plan owns plan-local criteria — each has exactly one owning layer:

| AC | Criterion | Owning proof |
|---|---|---|
| AC-477-01 | Every swept site renders byte-identical output | Unit: `src/lib/format.test.ts` (Tasks 1–4) + the existing net below (Tasks 5–18 stay green) |
| AC-477-02 | No locale-sensitive calls outside format.ts / export path / the one excluded input / tests | Task 21 grep (exact expected set) + guard (Task 19) |
| AC-477-03 | The guard fails the build when violated | Task 20 mutation ritual |
| AC-477-04 | No `$` literal adjacent to a formatted number in JSX | Task 21 grep = 0 |
| AC-477-05 | Whole suite green | `npm run verify:locked` (Task 21) |

Existing net per swept file (the reason byte-identity is provable): `sCurve.test.ts` (axis dates),
`monthMatrix.test.ts` (month label), `timesheet.test.tsx` + `ApprovalRow*` tests (week labels /
weekdays), `AccountingSnapshotsSection.test.tsx`, `revenue.test.ts`, e2e
`AC-SAR-040/041/043/050/071`, `AC-ENA-053/061`, `AC-TSP-011` (serial lane — run via `npm run e2e`,
never bare `npx playwright test`).

## Risks / flagged deltas (for the Director)

1. **Negative money sign placement** — the one deliberate micro-delta (see design §formatCurrencyCents):
   `-$1,234.50` instead of the old `$-1,234.50` for data-anomalous negatives. One-line revert if
   negatives are ruled reachable on `erp_outstanding_amount`.
2. **Guard scope** — the rule bans the `Intl`/`toLocale` *family*; it cannot see hand-rolled English
   arrays. Two known ones exist and are OUT of this issue's file list (do not sweep): `src/lib/gantt/ganttLayout.ts:473,481,553` (`MONTH_ABBREVS`) and `pages/project-detail/ProjectGantt.tsx:615` (months array). Flag to #468: route them through `format.ts` month formatters when the seam lands, or accept them as chart-axis labels.
3. **`date-fns format`** in components would also bypass the seam while passing the guard (only
   `monthMatrix.toIso` uses it today, structurally). Worth remembering for #468; not swept here.
4. Cross-component breakage is the known failure mode of this class of change — hence the
   whole-suite `verify:locked` gate, never touched-file runs, before declaring done.
