import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskListMatchReview } from './TaskListMatchReview';

afterEach(cleanup);

it('keeps a suggested stable match and initial source unwritten until the final confirmation', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(
    <TaskListMatchReview
      open
      projectId="project-42"
      projectName="Harbor Upgrade"
      lists={[{ id: 'list-42', name: 'Harbor Upgrade', space_name: 'Delivery', folder_name: 'Active' }]}
      proposedListId="list-42"
      canConfirm
      saving={false}
      error={null}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );

  const dialog = screen.getByRole('dialog', { name: 'Review ClickUp link' });
  const reviewButton = within(dialog).getByRole('button', { name: 'Review link' });
  expect(reviewButton).toBeDisabled();
  expect(onConfirm).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole('radio', { name: /Start with PMO tasks/i }));
  await user.click(reviewButton);
  expect(dialog).toHaveTextContent('Harbor Upgrade');
  expect(dialog).toHaveTextContent('list-42');
  expect(dialog).toHaveTextContent(/Start with PMO tasks/i);
  expect(dialog).toHaveTextContent(/initial task transfer only/i);
  expect(onConfirm).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole('button', { name: 'Confirm ClickUp link' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
    tier: 'clickup',
    projectId: 'project-42',
    listId: 'list-42',
    direction: 'push-seed',
  }));
});
