import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AreaHelpContext, useAreaNote, type AreaHelpEntry as Entry } from './useAreaHelp';
import { HelpPopover } from '@/src/components/ui';

/**
 * The work-order page's ONE help control (screen rules: at most one per screen). A section that has a definition to
 * give registers it while it is shown; the page's help, beside the area tabs, lists the open area's definitions.
 * The section itself keeps only figures, marks and the statements a person acts on.
 */

export const AreaHelpProvider: React.FC<{ children: (entries: Entry[], notes: string[]) => React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  // A note's id is its reason: two sections hiding figures for one reason hold one note between them.
  const [notes, setNotes] = useState<Record<string, { text: string; holders: number }>>({});
  const setNote = useCallback((id: string, text: string) => setNotes((all) => ({ ...all, [id]: { text, holders: (all[id]?.holders ?? 0) + 1 } })), []);
  const removeNote = useCallback((id: string) => setNotes((all) => {
    const left = (all[id]?.holders ?? 1) - 1;
    const next = { ...all };
    if (left > 0) next[id] = { ...all[id], holders: left }; else delete next[id];
    return next;
  }), []);
  const set = useCallback((entry: Entry) => setEntries((all) => {
    const i = all.findIndex((e) => e.id === entry.id);
    if (i < 0) return [...all, entry];
    const next = [...all]; next[i] = entry; return next;
  }), []);
  const remove = useCallback((id: string) => setEntries((all) => all.filter((e) => e.id !== id)), []);
  const registry = useMemo(() => ({ set, remove, setNote, removeNote }), [set, remove, setNote, removeNote]);
  return <AreaHelpContext.Provider value={registry}>{children(entries, Object.values(notes).map((n) => n.text))}</AreaHelpContext.Provider>;
};

/** The page's help control: nothing when the open area has nothing to define. */
export const AreaHelpButton: React.FC<{ subject: string; entries: Entry[] }> = ({ subject, entries }) => {
  if (entries.length === 0) return null;
  return (
    <HelpPopover subject={subject} side="bottom" className="size-11">
      <dl className="flex flex-col gap-3" data-testid="wo-area-help">
        {entries.map((e) => (
          <div key={e.id}>
            <dt className="font-medium">{e.title}</dt>
            <dd className="text-muted-foreground">{e.body}</dd>
          </div>
        ))}
      </dl>
    </HelpPopover>
  );
};

/** The open area's hidden-figures line: each reason once, above the area's sections. */
export const AreaNotes: React.FC<{ notes: string[] }> = ({ notes }) => (notes.length === 0 ? null : (
  <p role="note" className="mb-4 text-control text-muted-foreground" data-testid="wo-area-notes">{notes.join(' ')}</p>
));

/** Placed by a section that hides a figure because its cost mixes currencies: the area says why once, however many do. */
export const OtherCurrencyNote: React.FC = () => {
  const { t } = useTranslation('workOrderPva');
  useAreaNote('other-currency', t('otherCurrencyNote', 'Some cost is in another currency: figures that would mix currencies are not shown, and that cost is listed apart.'));
  return null;
};
