import React from 'react';
import { Tooltip } from './Tooltip';

export interface FigureContentProps {
  value: React.ReactNode;
  /** Exact amount behind a short figure: the hover title, and what screen readers read (once). */
  exactValue?: string;
  /** Why the figure is unknown: the visible figure becomes "—", the reason opens on hover, focus or tap. */
  unavailableReason?: string;
  /** False inside a link (no interactive-in-interactive): the link's own name must carry the reason. */
  reveal?: boolean;
}

/** The figure contract shared by KPITile and StatTiles (DESIGN.md Unknowable-Is-Not-Zero rule). */
export const FigureContent: React.FC<FigureContentProps> = ({ value, exactValue, unavailableReason, reveal = true }) => {
  if (unavailableReason) {
    if (!reveal) return <span aria-hidden="true" title={unavailableReason}>—</span>;
    return (
      <Tooltip content={unavailableReason}>
        <button
          type="button"
          aria-label={unavailableReason}
          className="touch-target pointer-events-auto relative z-10 cursor-help rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          —
        </button>
      </Tooltip>
    );
  }
  if (exactValue) {
    return (
      <>
        <span aria-hidden="true" title={exactValue}>{value}</span>
        <span className="sr-only">{exactValue}</span>
      </>
    );
  }
  return <>{value}</>;
};
