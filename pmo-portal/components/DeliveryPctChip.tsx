import React from 'react';

export interface DeliveryPctChipProps {
  /** Delivery % for this project. null → renders nothing (project has no milestones). */
  pct: number | null;
}

/**
 * Compact delivery mini-bar (AC-DEL-013, FR-DEL-017).
 * Returns null when pct is null (project has no milestones — no delivery figure rendered).
 * Accessible label: "Delivery {pct}%" so screen readers announce it correctly.
 */
export const DeliveryPctChip: React.FC<DeliveryPctChipProps> = ({ pct }) => {
  if (pct == null) return null;
  const rounded = Math.round(pct);
  return (
    <span aria-label={`Delivery ${rounded}%`} className="inline-flex items-center gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${rounded}%` }} />
      </span>
      <span className="text-[11.5px] font-bold tabular text-foreground">{rounded}%</span>
    </span>
  );
};

export default DeliveryPctChip;
