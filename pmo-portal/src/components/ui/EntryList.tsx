/**
 * EntryList — recent timesheet entries as a semantic <ul>/<li> list.
 * Shows date · project · note ("No note" when null/empty) · hours.
 * No em-dash placeholders (audit I3), tabular-nums on hours (T6).
 * Used by Engineer "Recent entries" and Timesheet "Recent entries this week".
 */
import React from 'react';
import type { FlatEntry } from '@/src/lib/timesheet-derive';

export interface EntryListProps {
  entries: FlatEntry[];
}

function formatEntryDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export const EntryList: React.FC<EntryListProps> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <div className="text-[14px] font-semibold text-foreground">No timesheet entries yet</div>
        <div className="max-w-[40ch] text-[12px] text-muted-foreground">
          Hours you log will show up here.
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/70">
      {entries.map((entry) => {
        const noteText = entry.notes?.trim() || 'No note';
        return (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-[9px]">
            <span className="w-[52px] shrink-0 pt-px text-[11px] text-muted-foreground">
              {formatEntryDate(entry.entry_date)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="truncate text-[13px] font-semibold">{entry.project?.name ?? 'Unknown'}</span>
                {entry.project?.code && (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {entry.project.code}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{noteText}</p>
            </div>
            <span className="w-10 shrink-0 text-right text-[12px] font-semibold tabular text-foreground">
              {entry.hours}h
            </span>
          </li>
        );
      })}
    </ul>
  );
};
