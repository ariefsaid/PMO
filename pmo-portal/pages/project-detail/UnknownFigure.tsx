import React from 'react';

/** An unknown amount has no numeric figure; show its reason in plain language. */
export const UnknownFigure: React.FC<{ reason: string }> = ({ reason }) => (
  <span role="status" className="text-sm font-normal text-muted-foreground">{reason}</span>
);
