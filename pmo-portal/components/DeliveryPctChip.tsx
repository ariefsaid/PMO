import React from 'react';

export interface DeliveryPctChipProps {
  /** Delivery % for this project. null → renders nothing (project has no milestones). */
  pct: number | null;
}

/**
 * Compact delivery-% pill (AC-DEL-013, FR-DEL-017).
 * Returns null when pct is null (project has no milestones — no chip rendered).
 * Accessible label: "Delivery {pct}%" so screen readers announce it correctly.
 */
export const DeliveryPctChip: React.FC<DeliveryPctChipProps> = ({ pct }) => {
  if (pct == null) return null;
  const rounded = Math.round(pct);
  return (
    <span
      aria-label={`Delivery ${rounded}%`}
      className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-bold text-primary"
    >
      {rounded}%
    </span>
  );
};

export default DeliveryPctChip;
