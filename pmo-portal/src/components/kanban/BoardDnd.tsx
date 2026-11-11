import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import type { DropState } from '@/src/components/ui/Kanban';
import type { MoveState } from './useOptimisticMoves';
import { buildAnnouncements, type BoardLabels } from './boardAnnouncements';

export interface BoardDndProps extends BoardLabels {
  onMove: (cardId: string, columnId: string) => void;
  /** The card's own column: dropping there is a silent no-op, so it shows no drop cue at all. */
  isHome: (cardId: string, columnId: string) => boolean;
  renderOverlay: (cardId: string) => React.ReactNode;
  children: React.ReactNode;
}

const ActiveCard = createContext<{ activeId: string | null; canDrop: BoardLabels['canDrop']; isHome: BoardDndProps['isHome'] }>({
  activeId: null, canDrop: () => false, isHome: () => false,
});

// The column under the pointer is the target; the overlay-overlap fallback covers a pointer in the gap between columns.
const underPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export const BoardDnd: React.FC<BoardDndProps> = ({ onMove, isHome, renderOverlay, children, ...labels }) => {
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
    <ActiveCard.Provider value={{ activeId, canDrop: labels.canDrop, isHome }}>
      <div data-dragging={activeId ? 'true' : undefined}>
        <DndContext
          sensors={sensors}
          collisionDetection={underPointer}
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
  children: (dropState: DropState | undefined) => React.ReactNode;
}> = ({ id, className, testId, nodeRef, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { activeId, canDrop, isHome } = useContext(ActiveCard);
  const dropState: DropState | undefined = !activeId || isHome(activeId, id)
    ? undefined
    : canDrop(activeId, id) ? (isOver ? 'target' : 'allowed') : 'blocked';
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
      // The held card leaves an empty dashed slot (its picture is the overlay); hidden, not dimmed, so no low-contrast text remains.
      className={isDragging ? 'rounded-lg outline-dashed outline-2 -outline-offset-2 outline-border [&>*]:invisible' : moveState ? 'rounded-lg ring-2 ring-primary/40' : undefined}
    >
      {children}
    </div>
  );
};
