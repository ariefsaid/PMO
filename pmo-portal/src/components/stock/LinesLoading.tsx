import React from 'react';
import { ListState } from '@/src/components/ui';
import type { LinesReserve } from './linesLoadingHeights';

/**
 * The line editor's loading block. It holds the height of the filled line editor at each breakpoint, so Details and
 * Note below it do not move when the item and unit reads land (#2197). `reserve` is in px: phone, then md and up.
 */
export const StockLinesLoading: React.FC<{ reserve: LinesReserve }> = ({ reserve }) => (
  <div
    data-testid="stock-lines-loading"
    className="min-h-[var(--lines-phone)] rounded-lg border border-border bg-card md:min-h-[var(--lines-md)]"
    style={{ '--lines-phone': `${reserve.phone}px`, '--lines-md': `${reserve.md}px` } as React.CSSProperties}
  >
    <ListState variant="loading" rows={4} />
  </div>
);
