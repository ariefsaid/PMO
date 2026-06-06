import React, { useRef } from 'react';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';
import { isClosable } from './workspaceTabs';
import type { WorkspaceContextValue } from './WorkspaceTabsProvider';
import { useWorkspaceTabsOptional } from './WorkspaceTabsProvider';

export interface TabStripProps {
  /** Inject the workspace API (defaults to the context — prop keeps it testable). */
  ws?: WorkspaceContextValue;
  onOpenPalette: () => void;
}

/**
 * Pure render of the workspace tab strip. role=tablist with roving tabindex:
 * Enter/Space select, ArrowLeft/Right move focus. Module tabs have no close
 * affordance; record tabs do. The `+` opens the command palette (⌘K).
 */
export const TabStrip: React.FC<TabStripProps> = ({ ws: wsProp, onOpenPalette }) => {
  const ctx = useWorkspaceTabsOptional();
  const ws = wsProp ?? ctx;
  const stripRef = useRef<HTMLDivElement>(null);

  if (!ws) return null;
  const { tabs, activeId, selectTab, closeTab } = ws;

  const focusTab = (index: number) => {
    const els = stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!els) return;
    const clamped = (index + els.length) % els.length;
    els[clamped]?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Open workspace tabs"
      className="tabstrip-scroll flex items-stretch overflow-x-auto border-b border-border bg-secondary/50 px-2"
      style={{ height: 'var(--tabstrip-h)', gridArea: 'tabstrip' }}
    >
      {tabs.map((tab, i) => {
        const active = tab.id === activeId;
        const closable = isClosable(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectTab(tab.id);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                focusTab(i + 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                focusTab(i - 1);
              }
            }}
            className={cn(
              'group inline-flex max-w-[240px] cursor-pointer items-center gap-2 border-l border-r border-t-2 border-l-transparent border-r-border border-t-transparent pl-3 pr-2.5 text-[13px] whitespace-nowrap transition-colors',
              'first:border-l-border',
              active
                ? 'border-t-primary bg-background font-semibold text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <span aria-hidden className="grid size-[15px] shrink-0 place-items-center [&_svg]:size-[15px]">
              <Icon name={tab.icon} />
            </span>
            {tab.code && (
              <span className="font-mono text-[11px] text-muted-foreground">{tab.code}</span>
            )}
            <span className="overflow-hidden text-ellipsis">{tab.label}</span>
            {tab.dirty && (
              <span
                data-testid={`dirty-${tab.id}`}
                aria-label="Unsaved changes"
                className="size-[7px] shrink-0 rounded-full bg-warning"
              />
            )}
            {closable && (
              <button
                type="button"
                aria-label={`Close ${tab.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="grid size-[18px] shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-80 [&_svg]:size-3"
              >
                <Icon name="x" strokeWidth={2.5} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        aria-label="Open command palette to add a tab"
        title="Open command palette (⌘K)"
        onClick={onOpenPalette}
        className="inline-flex h-full w-[34px] items-center justify-center text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground [&_svg]:size-4"
      >
        <Icon name="plus" />
      </button>
    </div>
  );
};
