import React from 'react';

export interface FigureContentProps {
  value: React.ReactNode;
  /** Exact amount behind a short figure; read by screen readers instead of the short form. */
  exactValue?: string;
  /** Why the figure is unknown: the visible figure becomes "—", the reason is sr-only. */
  unavailableReason?: string;
}

/** The figure contract shared by KPITile and StatTiles (DESIGN.md Unknowable-Is-Not-Zero rule). */
export const FigureContent: React.FC<FigureContentProps> = ({ value, exactValue, unavailableReason }) => {
  if (unavailableReason) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{unavailableReason}</span>
      </>
    );
  }
  if (exactValue) {
    return (
      <>
        <span aria-hidden="true">{value}</span>
        <span className="sr-only">{exactValue}</span>
      </>
    );
  }
  return <>{value}</>;
};
