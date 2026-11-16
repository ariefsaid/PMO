import React from 'react';
import { formatDateOnly } from '@/src/lib/format';

export interface EfakturCellProps {
  number: string | null;
  date: string | null;
}

/**
 * The e-Faktur facts as ONE list cell: the record-id number on top, the date as a
 * muted second line (the in-cell sub-value pattern). One cell, not two columns — a second column pushed
 * the row ⋯ trigger out of the 1440 view. An empty pair shows the honest dash.
 */
export const EfakturCell: React.FC<EfakturCellProps> = ({ number, date }) => {
  if (!number && !date) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {number && <span className="record-id truncate" title={number}>{number}</span>}
      {date && <span className="text-[12px] text-muted-foreground">{formatDateOnly(date.slice(0, 10))}</span>}
    </span>
  );
};

EfakturCell.displayName = 'EfakturCell';
