import React from 'react';

/** A figure that has no value: it is not drawn, and says why in the page's one hidden-figures line. */
export interface HiddenFigure {
  label: string;
  /** Short plain reason, e.g. "accounting is not connected". Figures with the same reason are counted together. */
  reason: string;
  /** Where the reason is fixed ("Set up"). */
  link?: { to: string; label: string };
}

export interface FigureHelpEntry {
  label: string;
  text: React.ReactNode;
}

export interface FigureScopeValue {
  setHidden: (owner: string, entries: HiddenFigure[]) => void;
  setHelp: (owner: string, entries: FigureHelpEntry[]) => void;
  hidden: HiddenFigure[];
  help: FigureHelpEntry[];
}

export const FigureScopeContext = React.createContext<FigureScopeValue | null>(null);

export const useFigureScope = () => React.useContext(FigureScopeContext);

/**
 * Report this component's hidden figures and help text to the nearest FigureScope for as long as it is
 * mounted. Returns whether a scope exists (a tile outside one keeps showing its reason in place).
 */
export function useFigureReport(hidden: HiddenFigure[], help: FigureHelpEntry[] = []): boolean {
  const scope = useFigureScope();
  const owner = React.useId();
  const setHidden = scope?.setHidden;
  const setHelp = scope?.setHelp;
  // The effect keys on content, not array identity, so a re-render with the same figures does not loop.
  const hiddenKey = JSON.stringify(hidden);
  const helpKey = JSON.stringify(help.map((h) => [h.label, typeof h.text === 'string' ? h.text : '']));
  const helpRef = React.useRef(help);
  helpRef.current = help;
  React.useEffect(() => {
    if (!setHidden) return;
    setHidden(owner, JSON.parse(hiddenKey) as HiddenFigure[]);
    return () => setHidden(owner, []);
  }, [setHidden, owner, hiddenKey]);
  React.useEffect(() => {
    if (!setHelp) return;
    setHelp(owner, helpRef.current);
    return () => setHelp(owner, []);
  }, [setHelp, owner, helpKey]);
  return scope != null;
}
