import { memo, useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { ListState } from '@/src/components/ui/ListState';
import { ViewToggle } from '@/src/components/ui/ViewToggle';
import { Icon } from '@/src/components/ui/icons';
import { cn } from '@/src/components/ui/cn';
import type { NativeReportColumn, NativeReportScalar, StatementReportPair } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { formatDateOnly } from '@/src/lib/format';
import {
  formatStatementAmount,
  hasNativeStatementEmphasis,
  plainNativeStatementLabel,
  type StatementAmountPresentation,
} from '@/src/lib/nativeStatementPresentation';

export interface NativeStatementPairProps {
  pair: Readonly<Pick<StatementReportPair, 'current' | 'prior'>>;
  reportTitle: string;
  /** Company the statement is prepared for (statement heading line). */
  companyLabel?: string | null;
  /** Reporting currency (the "Amounts in …" line). */
  currency: string;
  /** Generation display rule — fixed fraction digits + rounding method. */
  presentation: StatementAmountPresentation;
  labels: {
    current: string;
    prior: string;
    noActivity: string;
    noActivityDescription: string;
    notProvided: string;
    asAt: string;
    forThePeriod: string;
    amountsIn: string;
    periodShown: string;
    collapseGroup: (group: string) => string;
    expandGroup: (group: string) => string;
    collapseAll: string;
    expandAll: string;
  };
}

type Side = 'current' | 'prior';
type NativeRow = Readonly<Record<string, NativeReportScalar>>;
type ReportField = NativeReportColumn['columns'][number];

interface AccountLine {
  readonly kind: 'account';
  readonly key: string;
  /** The row the account label comes from (current side when present). */
  source: NativeRow;
  current: NativeRow | null;
  prior: NativeRow | null;
}
type StatementLine = AccountLine | { readonly kind: 'spacer'; readonly key: string };

const isEmptyRow = (row: NativeRow) => Object.keys(row).length === 0;

function accountKey(row: NativeRow): string | null {
  return typeof row.account === 'string' && row.account !== '' ? row.account : null;
}

/**
 * One statement line per account: current rows keep their native order and section breaks; a
 * prior-only account is placed just before the next account both periods share (native prior order).
 * Never reads the payload's cross-period `accounts` union.
 */
function mergeLines(current: readonly NativeRow[], prior: readonly NativeRow[]): StatementLine[] {
  const lines: StatementLine[] = [];
  const byAccount = new Map<string, AccountLine>();
  current.forEach((row, index) => {
    if (isEmptyRow(row)) {
      lines.push({ kind: 'spacer', key: `spacer-${index}` });
      return;
    }
    const line: AccountLine = { kind: 'account', key: `current-${index}`, source: row, current: row, prior: null };
    const key = accountKey(row);
    if (key !== null && !byAccount.has(key)) byAccount.set(key, line);
    lines.push(line);
  });
  let anchor = -1;
  let pending: AccountLine[] = [];
  prior.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const key = accountKey(row);
    const match = key === null ? undefined : byAccount.get(key);
    if (match && match.prior === null) {
      match.prior = row;
      const at = lines.indexOf(match);
      lines.splice(at, 0, ...pending);
      anchor = at + pending.length;
      pending = [];
      return;
    }
    pending.push({ kind: 'account', key: `prior-${index}`, source: row, current: null, prior: row });
  });
  if (anchor === -1) lines.push(...pending);
  else lines.splice(anchor + 1, 0, ...pending);
  while (lines.length > 0 && lines[lines.length - 1].kind === 'spacer') lines.pop();
  while (lines.length > 0 && lines[0].kind === 'spacer') lines.shift();
  return lines;
}

function primaryLabel(row: NativeRow): string {
  for (const field of ['account_name', 'acc_name'] as const) {
    const value = row[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return typeof row.account === 'string' ? row.account : '';
}

/** ERP computed lines (section totals, profit for the period) carry no hierarchy level. */
const isComputedRow = (row: NativeRow) => !Object.hasOwn(row, 'indent') || row.indent === null;

function displayLabel(row: NativeRow): string {
  // ERP quotes its computed-line labels ('Total Income (Credit)'); the quotes are not content.
  return plainNativeStatementLabel(primaryLabel(row)).replace(/^'(.*)'$/s, '$1');
}

function accountNumber(row: NativeRow, label: string): string | null {
  const value = row.acc_number;
  if (typeof value !== 'string' || value.trim() === '' || label.includes(value)) return null;
  return value;
}

function sideRange(side: NativeReportColumn): string {
  return `${formatDateOnly(side.period.fromDate)} – ${formatDateOnly(side.period.toDate)}`;
}

const moneyColumns = (side: NativeReportColumn) =>
  side.columns.filter((column) => column.type === 'currency' && column.hidden !== true);

/** P&L/BS: the period's own column(s); ERP's `total` duplicates a single period, so it is dropped. */
function periodColumns(side: NativeReportColumn): ReportField[] {
  const money = moneyColumns(side);
  const periods = money.filter((column) => column.fieldname !== 'total');
  return periods.length > 0 ? periods : money;
}

const HEADER_CELL = 'sticky top-0 z-[2] border-b border-border bg-card px-3 py-2 align-bottom text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground';
const ACCOUNT_CELL = 'sticky left-0 bg-card px-3 text-left';

function AmountCell({ row, column, presentation, notProvided, className }: {
  row: NativeRow | null;
  column: ReportField;
  presentation: StatementAmountPresentation;
  notProvided: string;
  className?: string;
}) {
  const value = row === null ? undefined : row[column.fieldname];
  let content: ReactNode;
  if (value === undefined || value === null) {
    content = (
      <span aria-label={`${notProvided}: ${plainNativeStatementLabel(column.label)}`} className="text-muted-foreground">—</span>
    );
  } else {
    if (typeof value !== 'string') throw new TypeError('Native currency cell is not a lexical decimal token');
    const amount = formatStatementAmount(value, presentation);
    content = amount.zero
      ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground">–</span>
          <span className="sr-only">{amount.text}</span>
        </>
      )
      : amount.text;
  }
  return <td className={cn('whitespace-nowrap px-3 text-right tabular', className)}>{content}</td>;
}

interface ValueColumn {
  readonly key: string;
  readonly side: Side;
  readonly column: ReportField;
  readonly header: ReactNode;
}

function collapsibleGroupLines(lines: StatementLine[]): AccountLine[] {
  // #2103: one forward pass. A group is collapsible exactly when the row after it is one step
  // deeper (a spacer or a computed total closes the section) — the old per-candidate look-ahead
  // re-scanned the rest of the statement for every group.
  const groups: AccountLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind !== 'account' || isComputedRow(line.source) || !(line.source.is_group === true || line.source.is_group_account === true)) continue;
    const next = lines[index + 1];
    if (next === undefined || next.kind === 'spacer' || isComputedRow(next.source)) continue;
    const indent = typeof line.source.indent === 'number' ? line.source.indent : 0;
    const nextIndent = typeof next.source.indent === 'number' ? next.source.indent : 0;
    if (nextIndent > indent) groups.push(line);
  }
  return groups;
}

function hasCollapsibleGroups(lines: StatementLine[]): boolean {
  return collapsibleGroupLines(lines).length > 0;
}

function CollapseAll({ lines, collapsed, setCollapsed, labels }: {
  lines: StatementLine[];
  collapsed: ReadonlySet<string>;
  setCollapsed: (next: (previous: Set<string>) => Set<string>) => void;
  labels: NativeStatementPairProps['labels'];
}) {
  if (!hasCollapsibleGroups(lines)) return null;
  const groups = collapsibleGroupLines(lines);
  const allCollapsed = groups.every((group) => collapsed.has(group.key));
  return <button type="button" className="h-8 rounded-md px-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setCollapsed(() => allCollapsed ? new Set() : new Set(groups.map((group) => group.key)))}>{allCollapsed ? labels.expandAll : labels.collapseAll}</button>;
}

interface StatementRowProps {
  line: AccountLine;
  valueColumns: readonly ValueColumn[];
  presentation: StatementAmountPresentation;
  notProvided: string;
  labels: NativeStatementPairProps['labels'];
  /** This row's own section can be collapsed/expanded. */
  collapsible: boolean;
  /** Only a collapsible row ever sees this change on a toggle — every other row keeps an identical prop set. */
  collapsed: boolean;
  onToggle: (key: string) => void;
  final: boolean;
}

/**
 * One account row. Memoised on primitives and stable containers (#2103): a group toggle changes
 * only the touched group's own `collapsed` flag, so the rest of a 10k-amount-cell statement is
 * reused instead of re-rendered.
 */
const StatementRow = memo(function StatementRow({ line, valueColumns, presentation, notProvided, labels, collapsible, collapsed, onToggle, final }: StatementRowProps) {
  const label = displayLabel(line.source);
  const computed = isComputedRow(line.source);
  const emphasized = line.source.is_group === true || line.source.is_group_account === true
    || hasNativeStatementEmphasis(primaryLabel(line.source));
  const indent = typeof line.source.indent === 'number' && line.source.indent > 0 ? line.source.indent : 0;
  const number = accountNumber(line.source, label);
  const rule = computed ? 'border-t border-foreground/60' : undefined;
  return (
    <tr
      data-row-kind={computed ? 'total' : emphasized ? 'group' : 'account'}
      className={cn('text-[13.5px] text-foreground [&>*]:py-1.5', computed || emphasized ? 'font-semibold' : 'font-normal')}
    >
      <th scope="row" className={cn(ACCOUNT_CELL, 'min-w-40 max-w-72 whitespace-normal break-words md:min-w-48', computed || emphasized ? 'font-semibold' : 'font-normal', rule)}>
        <div style={indent > 0 ? { paddingInlineStart: `calc(var(--spacing) * ${indent * 4})` } : undefined} className="flex items-center">
          {collapsible && (
            <button type="button" aria-label={(collapsed ? labels.expandGroup : labels.collapseGroup)(label)} aria-expanded={!collapsed} onClick={() => onToggle(line.key)} className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon name="chev" className={cn('transition-transform', !collapsed && 'rotate-90')} /></button>
          )}
          {number !== null && <span className="mr-2 font-normal text-muted-foreground tabular">{number}</span>}
          <span>{label}</span>
        </div>
      </th>
      {valueColumns.map(({ key, side, column }) => (
        <AmountCell
          key={key}
          row={line[side]}
          column={column}
          presentation={presentation}
          notProvided={notProvided}
          className={cn(rule, final && 'border-b-4 border-double border-foreground/60')}
        />
      ))}
    </tr>
  );
});

function StatementTable({ headingId, lines, account, valueColumns, presentation, notProvided, collapsed, setCollapsed, labels }: {
  headingId: string;
  lines: StatementLine[];
  collapsed: ReadonlySet<string>;
  setCollapsed: (next: (previous: Set<string>) => Set<string>) => void;
  labels: NativeStatementPairProps['labels'];
  account: string;
  valueColumns: readonly ValueColumn[];
  presentation: StatementAmountPresentation;
  notProvided: string;
}) {
  const last = lines[lines.length - 1];
  const footer = last?.kind === 'account' && isComputedRow(last.source) ? last : null;
  const bodyLines = footer === null ? lines : lines.slice(0, -1);

  // #2103: one pass over the body builds the group index and the collapsible-key set; the old code
  // ran `bodyLines.indexOf` inside the groups map and `groups.some` on every row (O(lines × groups)).
  const groupLines = collapsibleGroupLines(bodyLines);
  const collapsibleKeys = new Set(groupLines.map((line) => line.key));
  const groupIndexByKey = new Map<string, number>();
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index];
    if (line.kind === 'account' && collapsibleKeys.has(line.key) && !groupIndexByKey.has(line.key)) groupIndexByKey.set(line.key, index);
  }
  const hiddenLines = new Set<number>();
  for (const group of groupLines) {
    if (!collapsed.has(group.key)) continue;
    const index = groupIndexByKey.get(group.key);
    if (index === undefined) continue;
    const indent = typeof group.source.indent === 'number' ? group.source.indent : 0;
    for (let childIndex = index + 1; childIndex < bodyLines.length; childIndex += 1) {
      const child = bodyLines[childIndex];
      if (child.kind === 'spacer' || isComputedRow(child.source)) break;
      if ((typeof child.source.indent === 'number' ? child.source.indent : 0) <= indent) break;
      hiddenLines.add(childIndex);
    }
  }
  const toggle = useCallback((key: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  }), [setCollapsed]);

  const row = (line: AccountLine, final: boolean) => {
    const collapsible = collapsibleKeys.has(line.key);
    return (
      <StatementRow
        key={line.key}
        line={line}
        valueColumns={valueColumns}
        presentation={presentation}
        notProvided={notProvided}
        labels={labels}
        collapsible={collapsible}
        collapsed={collapsible && collapsed.has(line.key)}
        onToggle={toggle}
        final={final}
      />
    );
  };

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      tabIndex={0}
      className="relative max-h-[75dvh] min-w-0 overflow-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table aria-labelledby={headingId} className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th scope="col" className={cn(HEADER_CELL, 'left-0 z-[3] text-left')}>{account}</th>
            {valueColumns.map(({ key, header }) => (
              <th key={key} scope="col" className={cn(HEADER_CELL, 'whitespace-nowrap text-right')}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyLines.map((line, index) => hiddenLines.has(index) ? null : line.kind === 'spacer'
            ? <tr key={line.key} aria-hidden="true"><td colSpan={valueColumns.length + 1} className="h-3" /></tr>
            : row(line, false))}
        </tbody>
        {footer !== null && <tfoot>{row(footer, true)}</tfoot>}
      </table>
    </div>
  );
}

function StatementHeading({ id, reportTitle, companyLabel, periodLine, amountsLine }: {
  id: string;
  reportTitle: string;
  companyLabel?: string | null;
  periodLine: string;
  amountsLine: string;
}) {
  return (
    <div id={id} className="flex min-w-0 flex-col gap-0.5">
      <span className="sr-only">{reportTitle}</span>
      {companyLabel && <p className="min-w-0 break-words text-sm font-semibold text-foreground">{companyLabel}</p>}
      <p className="min-w-0 break-words text-sm text-muted-foreground">
        {periodLine}<span aria-hidden="true"> · </span><span className="sr-only">. </span>{amountsLine}
      </p>
    </div>
  );
}

const accountHeader = (side: NativeReportColumn) =>
  plainNativeStatementLabel(side.columns.find((column) => column.fieldname === 'account')?.label ?? 'Account');

function TrialBalance({ pair, reportTitle, companyLabel, currency, presentation, labels }: NativeStatementPairProps) {
  const headingId = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Side>('current');
  const side = pair[shown];
  // #2103: merged once per side, not once per render — the memoised rows compare row objects by
  // reference, so a re-merge would re-render the whole statement on every group toggle.
  const lines = useMemo(() => mergeLines(side.rows, []), [side.rows]);
  // Stable identity across a group toggle: the memoised rows compare these lists by reference (#2103).
  const valueColumns = useMemo(() => moneyColumns(side).map((column) => ({
    key: column.fieldname,
    side: 'current' as const,
    column,
    header: plainNativeStatementLabel(column.label),
  })), [side]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <StatementHeading
          id={headingId}
          reportTitle={reportTitle}
          companyLabel={companyLabel}
          periodLine={`${labels.forThePeriod} ${sideRange(side)}`}
          amountsLine={`${labels.amountsIn} ${currency}`}
        />
        <div className="flex flex-wrap items-start justify-end gap-2">
          <CollapseAll lines={lines} collapsed={collapsed} setCollapsed={setCollapsed} labels={labels} />
          <ViewToggle
          semantics="toggle"
          ariaLabel={labels.periodShown}
          value={shown}
          onChange={(nextSide) => {
            setCollapsed(new Set());
            setShown(nextSide);
          }}
          options={[{ value: 'current', label: labels.current }, { value: 'prior', label: labels.prior }]}
          />
        </div>
      </div>
      {lines.length === 0
        ? <ListState variant="empty" title={labels.noActivity} sub={labels.noActivityDescription} />
        : (
          <StatementTable
            headingId={headingId}
            lines={lines}
            account={accountHeader(side)}
            valueColumns={valueColumns}
            presentation={presentation}
            notProvided={labels.notProvided}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            labels={labels}
          />
        )}
    </div>
  );
}

function ComparativeStatement({ pair, reportTitle, companyLabel, currency, presentation, labels }: NativeStatementPairProps) {
  const headingId = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const currentSide = pair.current;
  const priorSide = pair.prior;
  const balanceSheet = currentSide.reportName === 'Balance Sheet';
  // #2103: merged once per pair, not once per render — the memoised rows compare row objects by
  // reference, so a re-merge would re-render the whole statement on every group toggle.
  const lines = useMemo(() => mergeLines(currentSide.rows, priorSide.rows), [currentSide, priorSide]);
  // Stable identity across a group toggle: the memoised rows compare these lists by reference (#2103).
  const valueColumns = useMemo<ValueColumn[]>(() => {
    const sideColumns = (side: Side): ValueColumn[] => periodColumns(side === 'current' ? currentSide : priorSide).map((column) => ({
      key: `${side}-${column.fieldname}`,
      side,
      column,
      header: (
        <span className="flex flex-col items-end gap-0.5">
          <span>{plainNativeStatementLabel(column.label)}</span>
          <span className="font-normal normal-case tracking-normal">{labels[side]}</span>
        </span>
      ),
    }));
    return [...sideColumns('current'), ...sideColumns('prior')];
  }, [currentSide, priorSide, labels]);
  const periodLine = balanceSheet
    ? `${labels.asAt} ${formatDateOnly(pair.current.period.toDate)}`
    : `${labels.forThePeriod} ${sideRange(pair.current)}`;
  const emptySides = (['current', 'prior'] as const).filter((side) => pair[side].rows.length === 0);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <StatementHeading
        id={headingId}
        reportTitle={reportTitle}
        companyLabel={companyLabel}
        periodLine={periodLine}
        amountsLine={`${labels.amountsIn} ${currency}`}
        />
        <CollapseAll lines={lines} collapsed={collapsed} setCollapsed={setCollapsed} labels={labels} />
      </div>
      {lines.length === 0
        ? <ListState variant="empty" title={labels.noActivity} sub={labels.noActivityDescription} />
        : (
          <>
            {emptySides.map((side) => (
              <p key={side} className="min-w-0 break-words text-xs text-muted-foreground">{labels[side]}: {labels.noActivity}</p>
            ))}
            <StatementTable
              headingId={headingId}
              lines={lines}
              account={accountHeader(pair.current)}
              valueColumns={valueColumns}
              presentation={presentation}
              notProvided={labels.notProvided}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              labels={labels}
            />
          </>
        )}
    </div>
  );
}

/**
 * Renders a saved ERP statement in standard statement form: one table, account hierarchy by native
 * indent, ERP totals ruled (final figure double-underlined), amounts right-aligned at the
 * generation's precision. P&L and Balance Sheet compare current vs previous in adjacent columns; the
 * Trial Balance shows one period at a time with a period switch. Figures are displayed, never recomputed.
 */
export function NativeStatementPair(props: NativeStatementPairProps) {
  return props.pair.current.reportName === 'Trial Balance'
    ? <TrialBalance {...props} />
    : <ComparativeStatement {...props} />;
}
