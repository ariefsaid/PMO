import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import type { MoveState } from './useOptimisticMoves';
import { buildAnnouncements, type BoardLabels } from './boardAnnouncements';

export interface BoardDndProps extends BoardLabels {
  onMove: (cardId: string, columnId: string) => void;
  renderOverlay: (cardId: string) => React.ReactNode;
  children: React.ReactNode;
}

const ActiveCard = createContext<{ activeId: string | null; canDrop: BoardLabels['canDrop'] }>({ activeId: null, canDrop: () => false });

export const BoardDnd: React.FC<BoardDndProps> = ({ onMove, renderOverlay, children, ...labels }) => {
  const { t } = useTranslation('boardDrag');
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );
  const end = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) onMove(String(e.active.id), String(e.over.id));
  };
  return (
    <ActiveCard.Provider value={{ activeId, canDrop: labels.canDrop }}>
      <div data-dragging={activeId ? 'true' : undefined}>
        <DndContext
          sensors={sensors}
          // Narrow edge zones: the default 20% band scrolled a wide board past the column the pointer was aiming at.
          autoScroll={{ threshold: { x: 0.08, y: 0.15 }, acceleration: 5 }}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={end}
          onDragCancel={() => setActiveId(null)}
          accessibility={{
            announcements: buildAnnouncements(t, labels),
            screenReaderInstructions: { draggable: t('boardDrag:instructions', "To change status with the keyboard, use the card's status control.") },
          }}
        >
          {children}
          <DragOverlay>{activeId ? renderOverlay(activeId) : null}</DragOverlay>
        </DndContext>
      </div>
    </ActiveCard.Provider>
  );
};

/**
 * Column drop target. Children is a render prop receiving the column's drop state while a card is dragged.
 * The div it renders IS the board's column element, so it takes the column's `className`, `data-testid`
 * and an optional `nodeRef` (e.g. the mobile-scroll column registry) rather than adding a wrapper.
 */
export const DroppableColumn: React.FC<{
  id: string;
  className?: string;
  testId?: string;
  nodeRef?: (el: HTMLDivElement | null) => void;
  children: (dropState: 'allowed' | 'blocked' | undefined) => React.ReactNode;
}> = ({ id, className, testId, nodeRef, children }) => {
  const { setNodeRef } = useDroppable({ id });
  const { activeId, canDrop } = useContext(ActiveCard);
  const dropState = activeId ? (canDrop(activeId, id) ? 'allowed' : 'blocked') : undefined;
  return (
    <div
      ref={(el) => { setNodeRef(el); nodeRef?.(el); }}
      className={className}
      data-testid={testId}
    >
      {children(dropState)}
    </div>
  );
};

/** Pointer/touch drag wrapper. Spreads listeners only: no role/tabIndex, the menu stays the keyboard path. */
export const DraggableCard: React.FC<{ id: string; disabled?: boolean; moveState?: MoveState | null; children: React.ReactNode }> = ({ id, disabled = false, moveState = null, children }) => {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, disabled: disabled || moveState !== null });
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      data-drag-state={moveState ?? undefined}
      aria-busy={moveState === 'saving' ? true : undefined}
      className={isDragging ? 'opacity-40' : moveState ? 'rounded-lg ring-2 ring-primary/40' : undefined}
    >
      {children}
    </div>
  );
};
