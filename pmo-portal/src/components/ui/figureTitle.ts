import type { FigureContentProps } from './FigureContent';

/** The `title` of a figure: the unavailable reason, else the exact amount behind a short figure. */
export function figureTitle({ exactValue, unavailableReason }: Pick<FigureContentProps, 'exactValue' | 'unavailableReason'>) {
  return unavailableReason ?? exactValue;
}
