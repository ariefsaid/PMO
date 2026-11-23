import React from 'react';

/**
 * The organisation's own tag for an item (its word for client-supplied stock) on a read surface. The name is
 * data from the firm's tag configuration — never a hardcoded business word — and an untagged item renders
 * nothing, so an ordinary item is not marked and no zero value is invented.
 */
export const StockItemTag: React.FC<{ name?: string | null }> = ({ name }) =>
  name ? (
    <span data-testid="stock-item-tag" className="mt-0.5 inline-block rounded border border-border px-1.5 py-0.5 text-sm font-medium">
      {name}
    </span>
  ) : null;
