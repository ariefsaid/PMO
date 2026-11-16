import React from 'react';

export interface FigureContentProps {
  value: React.ReactNode;
  /** Full whole-unit amount behind a short figure: hover title and screen-reader text. */
  exactValue?: string;
  /** Why the figure is unknown: omit the amount and show this plain-language reason. */
  unavailableReason?: string;
  /** A short word drawn in the tile in place of the reason (one line); the reason still goes to the page's hidden-figures line. */
  unavailableShort?: string;
}

/**
 * Layout rule 15: a figure is one unbreakable line. Both tile primitives put this on the element that holds
 * `FigureContent`; when space runs out the label wraps or the tile takes the row, never the number.
 */
export const FIGURE_LINE_CLASS = 'min-w-0 whitespace-nowrap tabular';

/** The figure contract shared by KPITile and StatTiles (DESIGN.md Unknowable-Is-Not-Zero rule). */
export const FigureContent: React.FC<FigureContentProps> = ({ value, exactValue, unavailableReason, unavailableShort }) => {
  if (unavailableReason && unavailableShort) {
    return <span role="status" className="whitespace-nowrap text-control font-normal text-muted-foreground">{unavailableShort}</span>;
  }
  if (unavailableReason) {
    return <span role="status" className="whitespace-normal text-control font-normal text-muted-foreground">{unavailableReason}</span>;
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
