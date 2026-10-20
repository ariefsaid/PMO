import React from 'react';

/** An unknown figure: "—" in the slot, the reason once for screen readers and hover (never prose in the slot). */
export const UnknownFigure: React.FC<{ reason: string }> = ({ reason }) => (
  <span title={reason}>
    <span aria-hidden="true">—</span>
    <span className="sr-only">{reason}</span>
  </span>
);
