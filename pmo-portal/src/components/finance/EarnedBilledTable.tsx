import React from 'react';

/** A cell of the earned/billed tables: money text, or words (not available, incomplete, restricted...) for a figure that is not a number. */
export interface EbCell { text: string; words: boolean }
export interface EbTableRow { key: string; testId: string; label: string; cells: EbCell[]; total?: boolean }

/** Presentational table shared by the project tab and the management pack (#2733). Scrolls sideways inside its own box on a phone. */
export const EarnedBilledTable: React.FC<{
  caption: string;
  firstColumn: string;
  columns: ReadonlyArray<{ key: string; label: string }>;
  rows: ReadonlyArray<EbTableRow>;
}> = ({ caption, firstColumn, columns, rows }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <caption className="py-1 text-left font-medium">{caption}</caption>
      <thead>
        <tr className="text-right text-muted-foreground">
          <th scope="col" className="py-1 pr-4 text-left font-normal">{firstColumn}</th>
          {columns.map((c) => <th key={c.key} scope="col" className="py-1 pr-4 font-normal last:pr-0">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-testid={r.testId} className={r.total ? 'border-t border-border font-semibold' : 'border-t border-border'}>
            <th scope="row" className="py-1 pr-4 text-left font-normal">{r.label}</th>
            {r.cells.map((c, i) => (
              <td key={columns[i]?.key ?? i} data-testid={`${r.testId}-${columns[i]?.key}`}
                className={`py-1 pr-4 text-right tabular-nums last:pr-0 ${c.words ? 'text-muted-foreground' : ''}`}>{c.text}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
