import type { TFunction } from 'i18next';
import type { Announcements } from '@dnd-kit/core';

export interface BoardLabels {
  cardLabel: (cardId: string) => string;
  columnLabel: (columnId: string) => string;
  canDrop: (cardId: string, columnId: string) => boolean;
}

export function buildAnnouncements(t: TFunction, l: BoardLabels): Announcements {
  const name = (id: unknown) => l.cardLabel(String(id));
  return {
    onDragStart: ({ active }) => t('boardDrag:announce.start', 'Picked up {{name}}.', { name: name(active.id) }),
    onDragOver: ({ active, over }) => over
      ? l.canDrop(String(active.id), String(over.id))
        ? t('boardDrag:announce.overAllowed', '{{name}} is over {{column}}. Drop allowed.', { name: name(active.id), column: l.columnLabel(String(over.id)) })
        : t('boardDrag:announce.overBlocked', '{{name}} is over {{column}}. This move is not allowed.', { name: name(active.id), column: l.columnLabel(String(over.id)) })
      : t('boardDrag:announce.overNone', '{{name}} is not over a column.', { name: name(active.id) }),
    onDragEnd: ({ active, over }) => over
      ? t('boardDrag:announce.dropped', 'Dropped {{name}} on {{column}}.', { name: name(active.id), column: l.columnLabel(String(over.id)) })
      : t('boardDrag:announce.cancelled', 'Move cancelled. {{name}} stays where it was.', { name: name(active.id) }),
    onDragCancel: ({ active }) => t('boardDrag:announce.cancelled', 'Move cancelled. {{name}} stays where it was.', { name: name(active.id) }),
  };
}
