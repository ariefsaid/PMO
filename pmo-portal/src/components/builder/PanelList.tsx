/**
 * PanelList — ordered panel cards with edit/remove/move-up/move-down (FR-VB-036/037, OD-VB-5).
 */
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import type { PanelSpec } from '@/src/lib/viewspec/types';

export interface PanelListProps {
  panels: PanelSpec[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

function panelSummary(p: PanelSpec): string {
  const cols = p.querySpec.select.slice(0, 3).join(', ');
  const more = p.querySpec.select.length > 3 ? ` +${p.querySpec.select.length - 3}` : '';
  return `${p.querySpec.entity} — ${cols}${more}`;
}

export const PanelList: React.FC<PanelListProps> = ({
  panels,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  // #2084: a move button disables at the list end, which would drop focus to <body> mid-reorder.
  // Remember which panel moved and which way; after the re-render put focus on the same
  // direction's button, or on the opposite one when that direction is now disabled.
  const pendingMove = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  useEffect(() => {
    const move = pendingMove.current;
    if (!move) return;
    pendingMove.current = null;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-panel-id]') ?? []).find(
      (el) => el.dataset.panelId === move.id,
    );
    const want = row?.querySelector<HTMLButtonElement>(`[data-move="${move.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`[data-move="${move.dir === 'up' ? 'down' : 'up'}"]`);
    (want && !want.disabled ? want : other)?.focus();
  }, [panels]);
  if (panels.length === 0) return null;

  return (
    <ol ref={listRef} aria-label={t('viewBuilder.panelList', 'Panel list')} className="flex flex-col gap-2">
      {panels.map((panel, idx) => (
        <li
          key={panel.id}
          data-panel-id={panel.id}
          className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <span className="text-[13px] font-semibold">{panel.primitive}</span>
            <span className="ml-2 text-[12px] text-muted-foreground">{panelSummary(panel)}</span>
          </div>
          <div className="ml-2 flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('viewBuilder.movePanelUp', 'Move panel {{number}} up', { number: idx + 1 })}
              disabled={idx === 0}
              data-move="up"
              onClick={() => {
                pendingMove.current = { id: panel.id, dir: 'up' };
                onMoveUp(idx);
              }}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('viewBuilder.movePanelDown', 'Move panel {{number}} down', { number: idx + 1 })}
              disabled={idx === panels.length - 1}
              data-move="down"
              onClick={() => {
                pendingMove.current = { id: panel.id, dir: 'down' };
                onMoveDown(idx);
              }}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('viewBuilder.editPanel', 'Edit panel {{number}}', { number: idx + 1 })}
              onClick={() => onEdit(idx)}
            >
              {t('viewBuilder.edit', 'Edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('viewBuilder.removePanel', 'Remove panel {{number}}', { number: idx + 1 })}
              onClick={() => onRemove(idx)}
            >
              {t('viewBuilder.remove', 'Remove')}
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
};

export default PanelList;
