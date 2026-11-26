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

const MID_AND_NARROW = {
  block: '@max-[56rem]:block',
  hide: '@max-[56rem]:sr-only',
  empty: '@max-[56rem]:invisible @max-[30rem]:hidden',
  dash: '@max-[30rem]:hidden',
  row: '@max-[56rem]:grid @max-[56rem]:grid-cols-3 @max-[56rem]:gap-x-6 @max-[56rem]:gap-y-3 @max-[56rem]:py-4 @max-[56rem]:first:pt-0 @max-[30rem]:grid-cols-[1fr_auto] @max-[30rem]:gap-y-1',
  rowHead: '@max-[56rem]:static @max-[56rem]:col-span-2 @max-[56rem]:block @max-[56rem]:p-0 @max-[56rem]:max-w-none @max-[30rem]:col-span-1',
  cell: '@max-[56rem]:block @max-[56rem]:p-0 @max-[30rem]:col-span-full @max-[56rem]:text-left @max-[56rem]:before:block @max-[56rem]:before:font-normal @max-[56rem]:before:text-muted-foreground @max-[56rem]:before:content-[attr(data-label)] @max-[30rem]:flex @max-[30rem]:justify-between @max-[30rem]:gap-4 @max-[30rem]:text-right',
  action: '@max-[56rem]:col-start-3 @max-[56rem]:row-start-1 @max-[56rem]:block @max-[56rem]:p-0 @max-[56rem]:text-right @max-[30rem]:col-start-2',
};
const NARROW_ONLY = {
  block: '@max-[30rem]:block',
  hide: '@max-[30rem]:sr-only',
  empty: '@max-[30rem]:hidden',
  dash: '@max-[30rem]:hidden',
  row: '@max-[30rem]:grid @max-[30rem]:grid-cols-1 @max-[30rem]:gap-y-1 @max-[30rem]:py-3 @max-[30rem]:first:pt-0',
  rowHead: '@max-[30rem]:static @max-[30rem]:block @max-[30rem]:p-0',
  cell: '@max-[30rem]:flex @max-[30rem]:justify-between @max-[30rem]:gap-4 @max-[30rem]:p-0 @max-[30rem]:before:font-normal @max-[30rem]:before:text-muted-foreground @max-[30rem]:before:content-[attr(data-label)]',
  action: '@max-[30rem]:block @max-[30rem]:p-0 @max-[30rem]:pt-2 @max-[30rem]:text-left',
};

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
  // Too narrow for every column (container width, not viewport): a row becomes a small card. Mid widths lay its figures in
  // three columns, label over value; a phone width lists them, label left and value right. Tailwind needs literal classes.
  const k = dense ? NARROW_ONLY : MID_AND_NARROW;
  const cell = cn('py-2.5 align-baseline first:pl-0 last:pr-0', 'pl-4');
  const head = 'sticky left-0 z-[1] bg-card py-2.5 pr-4 text-left align-baseline';
  return (
    <div className={cn('@container overflow-x-auto', !dense && '-mt-1', !dense && '-mx-[var(--panel-inset)] px-[var(--panel-inset)]')} data-testid={testId}>
      <table className={cn('w-full border-collapse text-control', k.block)}>
        <caption className="sr-only">{caption}</caption>
        <thead className={cn('text-muted-foreground [&>tr:first-child>*]:pt-0', k.hide)}>
          {groups && (
            <tr>
              <td className="sticky left-0 z-[1] bg-card" />
              {groups.map(([label, span], i) => (
                <th key={i} scope="colgroup" colSpan={span} className={cn('pt-1 font-medium text-foreground', 'pl-4')}>
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
        <tbody className={k.block}>
          {rows.map((r) => (
            <tr key={r.key} data-testid={r.testId}
              className={cn('border-b border-border last:border-b-0', k.row, r.total && 'border-t-2 border-t-border font-semibold')}>
              <th scope="row" className={cn(head, k.rowHead, !dense && 'min-w-[11rem] max-w-[24rem]', r.total ? 'font-semibold' : 'font-normal')}>{r.head}</th>
              {r.cells.map((c, i) => (
                <td key={columns[i]?.key ?? i} data-testid={c?.testId} data-label={phoneLabel(i)}
                  className={cn(cell, 'whitespace-nowrap text-right tabular-nums', k.cell, c === null && k.empty, c?.text === '—' && k.dash,
                    c?.tone === 'words' && 'font-normal text-muted-foreground',
                    c?.tone === 'over' && 'text-destructive')}>
                  {c?.text ?? null}
                </td>
              ))}
              {hasActions && <td className={cn(cell, 'whitespace-nowrap py-1.5 text-right align-baseline', k.action, r.action == null && k.empty)}>{r.action ?? null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
