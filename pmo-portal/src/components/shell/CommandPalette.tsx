import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  sub?: string;
  /** Mono record code (e.g. PRJ-0142). */
  code?: string;
  icon: IconName;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  items: PaletteItem[];
  onClose: () => void;
  /** Element to restore focus to when the palette closes (closes mockup gap). */
  returnFocusTo?: HTMLElement | null;
}

/**
 * ⌘K command palette. role=dialog aria-modal, grouped role=listbox/option,
 * ArrowUp/Down navigate, Enter runs, Esc closes, focus trapped, focus restored
 * to the trigger on close.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  items,
  onClose,
  returnFocusTo,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.sub?.toLowerCase().includes(q) ||
        i.code?.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Reset + focus the input on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Restore focus to the trigger when closed.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusTo?.focus();
    wasOpen.current = open;
  }, [open, returnFocusTo]);

  // Keep the selection in range as the filter narrows.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selected];
      if (item) {
        item.run();
        onClose();
      }
    } else if (e.key === 'Tab') {
      // Trap focus inside the panel (single focusable: the input).
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  // Group the filtered items in stable group order.
  const groups: { name: string; items: PaletteItem[] }[] = [];
  for (const item of filtered) {
    let g = groups.find((x) => x.name === item.group);
    if (!g) {
      g = { name: item.group, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[950] flex items-start justify-center pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="cmdk-backdrop"
        className="absolute inset-0 bg-[hsl(240_10%_4%/0.4)] backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="cmdk-anim relative w-full max-w-[600px] overflow-hidden rounded-[12px] border border-border bg-popover shadow-[0_24px_60px_hsl(240_10%_4%/0.35)]"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 [&_svg]:size-[18px] [&_svg]:text-muted-foreground">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-label="Search projects, records, or run a command"
            placeholder="Search projects, PRs, customers, or run a command…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="rounded-[5px] border border-border bg-secondary px-[7px] py-0.5 text-[11px] font-semibold text-muted-foreground">
            Esc
          </span>
        </div>

        <div id="cmdk-list" role="listbox" aria-label="Command results" className="max-h-[380px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-8 text-center text-[13px] text-muted-foreground">
              No results for “{query}”
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.name}>
                <div className="px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  {group.name}
                </div>
                {group.items.map((item) => {
                  flatIndex += 1;
                  const isSel = flatIndex === selected;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isSel}
                      onClick={() => {
                        item.run();
                        onClose();
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-[11px] rounded-[7px] px-2.5 py-[9px] text-sm',
                        isSel && 'bg-accent'
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-secondary text-muted-foreground [&_svg]:size-[15px]">
                        <Icon name={item.icon} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="font-medium leading-tight">{item.title}</span>
                        {item.sub && (
                          <span className="text-[11.5px] leading-tight text-muted-foreground">
                            {item.sub}
                          </span>
                        )}
                      </span>
                      {item.code && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {item.code}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
