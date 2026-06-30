/**
 * PanelList — ordered panel cards with edit/remove/move-up/move-down (FR-VB-036/037, OD-VB-5).
 */
import React from 'react';
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
  if (panels.length === 0) return null;

  return (
    <ol aria-label="Panel list" className="flex flex-col gap-2">
      {panels.map((panel, idx) => (
        <li
          key={panel.id}
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
              aria-label={`Move panel ${idx + 1} up`}
              disabled={idx === 0}
              onClick={() => onMoveUp(idx)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move panel ${idx + 1} down`}
              disabled={idx === panels.length - 1}
              onClick={() => onMoveDown(idx)}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit panel ${idx + 1}`}
              onClick={() => onEdit(idx)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove panel ${idx + 1}`}
              onClick={() => onRemove(idx)}
            >
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ol>
  );
};

export default PanelList;
