import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BoardDnd, DraggableCard, DroppableColumn } from '../BoardDnd';
import { buildAnnouncements } from '../boardAnnouncements';

const t = ((key: string, _d: string, o?: Record<string, string>) => `${key}|${o?.name ?? ''}|${o?.column ?? ''}`) as never;

describe('BoardDnd', () => {
  it('AC-DND-012: announces start, over allowed / not allowed, drop and cancel with card and column names', () => {
    const a = buildAnnouncements(t, { cardLabel: () => 'Deal A', columnLabel: () => 'Tender', canDrop: (_c, col) => col === 'ok' });
    expect(a.onDragStart!({ active: { id: 'c1' } } as never)).toBe('boardDrag:announce.start|Deal A|');
    expect(a.onDragOver!({ active: { id: 'c1' }, over: { id: 'ok' } } as never)).toBe('boardDrag:announce.overAllowed|Deal A|Tender');
    expect(a.onDragOver!({ active: { id: 'c1' }, over: { id: 'no' } } as never)).toBe('boardDrag:announce.overBlocked|Deal A|Tender');
    expect(a.onDragEnd!({ active: { id: 'c1' }, over: { id: 'ok' } } as never)).toBe('boardDrag:announce.dropped|Deal A|Tender');
    expect(a.onDragCancel!({ active: { id: 'c1' } } as never)).toBe('boardDrag:announce.cancelled|Deal A|');
  });
  it('AC-DND-013: a click without movement reaches the card and starts no drag', () => {
    const onClick = vi.fn(); const onMove = vi.fn();
    render(<BoardDnd canDrop={() => true} onMove={onMove} cardLabel={() => 'A'} columnLabel={() => 'X'} renderOverlay={() => null}>
      <DroppableColumn id="X">{() => <DraggableCard id="c1"><button onClick={onClick}>Open A</button></DraggableCard>}</DroppableColumn>
    </BoardDnd>);
    fireEvent.click(screen.getByRole('button', { name: 'Open A' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });
  it('AC-DND-012: a draggable card adds no role or tabindex of its own (menu stays the keyboard path)', () => {
    render(<BoardDnd canDrop={() => true} onMove={vi.fn()} cardLabel={() => 'A'} columnLabel={() => 'X'} renderOverlay={() => null}>
      <DroppableColumn id="X">{() => <DraggableCard id="c1"><span>A</span></DraggableCard>}</DroppableColumn>
    </BoardDnd>);
    const wrapper = screen.getByText('A').parentElement!;
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.getAttribute('tabindex')).toBeNull();
  });
});
