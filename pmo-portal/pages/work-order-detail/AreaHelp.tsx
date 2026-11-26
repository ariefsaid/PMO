import React, { useCallback, useMemo, useState } from 'react';
import { AreaHelpContext, type AreaHelpEntry as Entry } from './useAreaHelp';
import { HelpPopover } from '@/src/components/ui';

/**
 * The work-order page's ONE help control (screen rules: at most one per screen). A section that has a definition to
 * give registers it while it is shown; the page's help, beside the area tabs, lists the open area's definitions.
 * The section itself keeps only figures, marks and the statements a person acts on.
 */

export const AreaHelpProvider: React.FC<{ children: (entries: Entry[]) => React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const set = useCallback((entry: Entry) => setEntries((all) => {
    const i = all.findIndex((e) => e.id === entry.id);
    if (i < 0) return [...all, entry];
    const next = [...all]; next[i] = entry; return next;
  }), []);
  const remove = useCallback((id: string) => setEntries((all) => all.filter((e) => e.id !== id)), []);
  const registry = useMemo(() => ({ set, remove }), [set, remove]);
  return <AreaHelpContext.Provider value={registry}>{children(entries)}</AreaHelpContext.Provider>;
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
