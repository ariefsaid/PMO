import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { KanbanColumn } from '../Kanban';

describe('KanbanColumn drop state', () => {
  it('AC-DND-012: shows a non-colour cue for allowed and blocked drop states', () => {
    const { rerender } = render(<KanbanColumn title="Tender" count={0} dropState="allowed" />);
    expect(screen.getByText('Drop to move here')).toBeInTheDocument();
    rerender(<KanbanColumn title="Tender" count={0} dropState="blocked" />);
    expect(screen.getByText("Can't move here")).toBeInTheDocument();
    rerender(<KanbanColumn title="Tender" count={0} />);
    expect(screen.queryByText("Can't move here")).toBeNull();
  });
});
