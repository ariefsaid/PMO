import React from 'react';

export const NeedsYouReason: React.FC<{ id: string; text: string }> = ({ id, text }) => (
  <div
    data-testid={`needs-you-reason-${id}`}
    className="flex min-h-8 items-center border-b border-border/70 bg-warning/5 px-3.5 py-1.5 text-[13px] font-medium text-warning-foreground"
  >
    {text}
  </div>
);
