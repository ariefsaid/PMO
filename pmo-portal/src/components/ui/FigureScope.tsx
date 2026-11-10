import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

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

interface FigureScopeValue {
  setHidden: (owner: string, entries: HiddenFigure[]) => void;
  setHelp: (owner: string, entries: FigureHelpEntry[]) => void;
  hidden: HiddenFigure[];
  help: FigureHelpEntry[];
}

const FigureScopeContext = React.createContext<FigureScopeValue | null>(null);

/**
 * One page's figures: tiles inside it that have no value hide themselves and report here, and tiles with
 * help text hand it here. Render `<FigureHiddenLine />` once and pass `<FigureHelpList />` to the page's
 * help control. Outside a scope a tile falls back to showing its reason in place (old behaviour).
 */
export const FigureScope: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hiddenByOwner, setHiddenByOwner] = React.useState<Record<string, HiddenFigure[]>>({});
  const [helpByOwner, setHelpByOwner] = React.useState<Record<string, FigureHelpEntry[]>>({});
  const value = React.useMemo<FigureScopeValue>(() => ({
    setHidden: (owner, entries) => setHiddenByOwner((prev) => {
      if (entries.length === 0 && !(owner in prev)) return prev;
      const next = { ...prev };
      if (entries.length === 0) delete next[owner]; else next[owner] = entries;
      return next;
    }),
    setHelp: (owner, entries) => setHelpByOwner((prev) => {
      if (entries.length === 0 && !(owner in prev)) return prev;
      const next = { ...prev };
      if (entries.length === 0) delete next[owner]; else next[owner] = entries;
      return next;
    }),
    hidden: Object.values(hiddenByOwner).flat(),
    help: Object.values(helpByOwner).flat(),
  }), [hiddenByOwner, helpByOwner]);
  return <FigureScopeContext.Provider value={value}>{children}</FigureScopeContext.Provider>;
};

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

/** "3 figures hidden: accounting is not connected · Set up". Renders nothing when every figure has a value. */
export const FigureHiddenLine: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const scope = useFigureScope();
  const hidden = scope?.hidden ?? [];
  if (hidden.length === 0) return null;
  const reasons = [...new Set(hidden.map((h) => h.reason))];
  const links = [...new Map(hidden.flatMap((h) => (h.link ? [[h.link.to, h.link] as const] : []))).values()];
  return (
    <p role="status" data-testid="figures-hidden" className={className ?? 'text-control text-muted-foreground'}>
      {t('figures.hidden', { count: hidden.length, reason: reasons.join('; '), defaultValue_one: '{{count}} figure hidden: {{reason}}', defaultValue_other: '{{count}} figures hidden: {{reason}}' })}
      {links.map((link) => (
        <React.Fragment key={link.to}>
          {' · '}
          <Link to={link.to} className="font-medium text-primary-text underline-offset-4 hover:underline">{link.label}</Link>
        </React.Fragment>
      ))}
    </p>
  );
};

/** The figure tiles' help texts as one list, for the page's single help control (`PageHeader help`). Null when there is none. */
export const FigureHelpList: React.FC = () => {
  const scope = useFigureScope();
  const help = scope?.help ?? [];
  if (help.length === 0) return null;
  return (
    <dl className="space-y-2" data-testid="figure-help-list">
      {help.map((entry, i) => (
        <div key={`${entry.label}:${i}`}>
          <dt className="font-semibold">{entry.label}</dt>
          <dd>{entry.text}</dd>
        </div>
      ))}
    </dl>
  );
};
