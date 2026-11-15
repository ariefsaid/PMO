import React from 'react';

/** The lines as one figure: the lead line, then each other currency on its own quieter line. */
export const CurrencyLines: React.FC<{ lines: readonly string[] }> = ({ lines: [lead, ...others] }) => (
  <>
    <span data-currency-line>{lead}</span>
    {others.map((line) => (
      <span key={line} data-currency-line className="block text-control font-medium text-muted-foreground">{line}</span>
    ))}
  </>
);
