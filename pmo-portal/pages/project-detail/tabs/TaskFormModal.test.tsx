import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import TaskFormModal from './TaskFormModal';

const h = vi.hoisted(() => ({
  profiles: { data: [] as unknown[], isPending: false, isError: false },
}));

vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => h.profiles }));

describe('TaskFormModal assignee empty state', () => {
  beforeEach(() => {
    h.profiles = { data: [], isPending: false, isError: false };
  });

  it('explains that no one can be assigned and points to Administration', async () => {
    const user = userEvent.setup();
    render(
      <TaskFormModal
        task={null}
        projectId="project-1"
        allTasks={[]}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => undefined)}
        onUpdate={vi.fn(async () => undefined)}
        onError={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/Task name/), 'Prepare the contract');
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }));

    expect(await screen.findByText('No assignable people are available. Add or activate a user in Administration.')).toBeInTheDocument();
  });
});
