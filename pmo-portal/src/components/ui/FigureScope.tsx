import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FigureScopeContext, useFigureScope, type FigureHelpEntry, type FigureScopeValue, type HiddenFigure } from './useFigureScope';

/**
 * One page's figures: tiles inside it that have no value hide themselves and report here, and tiles with
 * help text hand it here. Render `<FigureHiddenLine />` once and pass `<FigureHelpList />` to the page's
 * help control. Outside a scope a tile falls back to showing its reason in place (old behaviour).
 */
export const FigureScope: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hiddenByOwner, setHiddenByOwner] = React.useState<Record<string, HiddenFigure[]>>({});
  const [helpByOwner, setHelpByOwner] = React.useState<Record<string, FigureHelpEntry[]>>({});
  // Stable setters: tiles key their effects on these, so a new identity per state change would loop.
  const setHidden = React.useCallback((owner: string, entries: HiddenFigure[]) => setHiddenByOwner((prev) => {
    if (entries.length === 0 && !(owner in prev)) return prev;
    const next = { ...prev };
    if (entries.length === 0) delete next[owner]; else next[owner] = entries;
    return next;
  }), []);
  const setHelp = React.useCallback((owner: string, entries: FigureHelpEntry[]) => setHelpByOwner((prev) => {
    if (entries.length === 0 && !(owner in prev)) return prev;
    const next = { ...prev };
    if (entries.length === 0) delete next[owner]; else next[owner] = entries;
    return next;
  }), []);
  const value = React.useMemo<FigureScopeValue>(() => ({
    setHidden,
    setHelp,
    hidden: Object.values(hiddenByOwner).flat(),
    help: Object.values(helpByOwner).flat(),
  }), [setHidden, setHelp, hiddenByOwner, helpByOwner]);
  return <FigureScopeContext.Provider value={value}>{children}</FigureScopeContext.Provider>;
};

/** "3 figures hidden: accounting is not connected · Set up". Renders nothing when every figure has a value. */
export const FigureHiddenLine: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation('status');
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
