/**
 * PanelList — ordered panel cards with edit/remove/move-up/move-down (FR-VB-036/037, OD-VB-5).
 */
import React from 'react';
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
  if (panels.length === 0) return null;

  return (
    <ol aria-label={t('viewBuilder.panelList', 'Panel list')} className="flex flex-col gap-2">
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
              aria-label={t('viewBuilder.movePanelUp', 'Move panel {{number}} up', { number: idx + 1 })}
              disabled={idx === 0}
              onClick={() => onMoveUp(idx)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('viewBuilder.movePanelDown', 'Move panel {{number}} down', { number: idx + 1 })}
              disabled={idx === panels.length - 1}
              onClick={() => onMoveDown(idx)}
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
