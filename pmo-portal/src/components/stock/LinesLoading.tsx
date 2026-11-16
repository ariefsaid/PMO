import React from 'react';
import { ListState } from '@/src/components/ui';

/**
 * The line editor's loading block. It holds the height of one filled line card (plus its add-line
 * action) at each breakpoint, so Details and Note below it do not move when the item and unit reads
 * land (#2197). `minHeight` is a pair of Tailwind min-height classes: phone, then md and up.
 */
export const StockLinesLoading: React.FC<{ minHeight: string }> = ({ minHeight }) => (
  <div data-testid="stock-lines-loading" className={`rounded-lg border border-border bg-card ${minHeight}`}>
    <ListState variant="loading" rows={4} />
  </div>
);
