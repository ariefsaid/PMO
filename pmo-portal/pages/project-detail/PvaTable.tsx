import React from 'react';
import { cn } from '@/src/components/ui/cn';

/** One figure cell: its text, and whether it is words (muted) or an overspend (danger, the word "over" in the text). */
export interface PvaCell { text: React.ReactNode; tone?: 'words' | 'over'; testId?: string }
export interface PvaRow {
  key: string;
  testId?: string;
  head: React.ReactNode;
  cells: ReadonlyArray<PvaCell | null>;
  total?: boolean;
  action?: React.ReactNode;
}
export interface PvaColumn { key: string; label: string }

/**
 * The plan-vs-actual table family (#2519 block, its work-order twin): one figure per cell, right-aligned tabular figures on one
 * baseline, headers over their columns, totals on the same edges. The first and last cells sit on the card's inset, so the
 * table shares the heading's left edge. On a phone each row reads as its name over labelled figures (a card per row).
 */
export const PvaTable: React.FC<{
  caption: string;
  firstColumn: React.ReactNode;
  columns: ReadonlyArray<PvaColumn>;
  rows: ReadonlyArray<PvaRow>;
  /** Group labels over runs of columns (planned/actual pairs): `[label, span]`, after the first column. */
  groups?: ReadonlyArray<[string, number]>;
  actionsLabel?: string;
  testId?: string;
  /** A narrow home (a drawer): the name column takes only what it needs and figures sit closer. */
  dense?: boolean;
}> = ({ caption, firstColumn, columns, rows, groups, actionsLabel, testId, dense = false }) => {
  const hasActions = actionsLabel !== undefined;
  // The label a phone shows beside each figure: its group and column ("Direct cost · Plan").
  const groupOf: string[] = (groups ?? []).flatMap(([label, span]) => Array<string>(span).fill(label));
  const phoneLabel = (i: number) => (groupOf[i] ? `${groupOf[i]} · ${columns[i]?.label ?? ''}` : columns[i]?.label ?? '');
  const stacked = 'max-sm:flex max-sm:justify-between max-sm:gap-4 max-sm:py-1 max-sm:pl-0 max-sm:before:font-normal max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]';
  const cell = cn('py-2.5 align-baseline first:pl-0 last:pr-0', dense ? 'pl-4' : 'pl-6');
  const head = 'sticky left-0 z-[1] bg-card py-2.5 pr-4 text-left align-baseline';
  return (
    <div className={cn('overflow-x-auto max-sm:overflow-visible', !dense && 'sm:-mx-[var(--panel-inset)] sm:px-[var(--panel-inset)]')} data-testid={testId} data-layout-ignore>
      <table className="w-full border-collapse text-control max-sm:block">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted-foreground max-sm:sr-only">
          {groups && (
            <tr>
              <td className="sticky left-0 z-[1] bg-card" />
              {groups.map(([label, span], i) => (
                <th key={i} scope="colgroup" colSpan={span} className="pl-6 pt-1 font-medium text-foreground">
                  <span className="block border-b border-border pb-1.5 text-center">{label}</span>
                </th>
              ))}
              {hasActions && <td />}
            </tr>
          )}
          <tr className="border-b border-border">
            <th scope="col" className={cn(head, 'font-normal', dense && 'w-full')}>{firstColumn}</th>
            {columns.map((c) => <th key={c.key} scope="col" className={cn(cell, 'whitespace-nowrap text-right font-normal', dense && 'min-w-[10rem]')}>{c.label}</th>)}
            {hasActions && <th scope="col" className={cn(cell, 'font-normal')}><span className="sr-only">{actionsLabel}</span></th>}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((r) => (
            <tr key={r.key} data-testid={r.testId}
              className={cn('border-b border-border last:border-b-0 max-sm:block max-sm:py-3', r.total && 'border-t border-t-foreground/30 font-semibold')}>
              <th scope="row" className={cn(head, 'max-sm:static max-sm:block max-sm:py-1', !dense && 'min-w-[13rem] max-w-[24rem]', r.total ? 'font-semibold' : 'font-normal')}>{r.head}</th>
              {r.cells.map((c, i) => (
                <td key={columns[i]?.key ?? i} data-testid={c?.testId} data-label={phoneLabel(i)}
                  className={cn(cell, stacked, 'whitespace-nowrap text-right tabular-nums', (c === null || c.text === '—') && 'max-sm:hidden',
                    c?.tone === 'words' && 'font-normal text-muted-foreground',
                    c?.tone === 'over' && 'text-destructive')}>
                  {c?.text ?? null}
                </td>
              ))}
              {hasActions && <td className={cn(cell, 'whitespace-nowrap py-1.5 text-right align-baseline max-sm:block max-sm:pl-0 max-sm:pt-2 max-sm:text-left', r.action == null && 'max-sm:hidden')}>{r.action ?? null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
