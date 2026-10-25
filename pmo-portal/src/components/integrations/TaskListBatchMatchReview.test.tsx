import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskListBatchMatchReview } from './TaskListBatchMatchReview';

afterEach(cleanup);

const proposals = [
  {
    projectId: 'project-1',
    projectName: 'Harbor Upgrade',
    list: { id: 'list-1', name: 'Harbor Upgrade', space_name: 'Delivery', folder_name: null },
  },
  {
    projectId: 'project-2',
    projectName: 'North Office',
    list: { id: 'list-2', name: 'North Office', space_name: 'Delivery', folder_name: 'Active' },
  },
];

it('AC-ADMIA-014: selects clear matches together, confirms task source, and permits a per-project override', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const onComplete = vi.fn();
  render(
    <TaskListBatchMatchReview
      open
      proposals={proposals}
      canConfirm
      onClose={vi.fn()}
      onComplete={onComplete}
      onConfirm={onConfirm}
    />,
  );

  const dialog = screen.getByRole('dialog', { name: 'Review clear ClickUp matches' });
  expect(within(dialog).getByRole('checkbox', { name: /Harbor Upgrade/ })).toBeChecked();
  expect(within(dialog).getByRole('checkbox', { name: /North Office/ })).toBeChecked();
  await user.click(within(dialog).getByRole('radio', { name: /Start with PMO tasks/i }));
  await user.selectOptions(within(dialog).getByLabelText(/Initial task source for North Office/i), 'pull-adopt');
  await user.click(within(dialog).getByRole('button', { name: 'Review project connections' }));

  expect(dialog).toHaveTextContent('Harbor Upgrade');
  expect(dialog).toHaveTextContent('North Office');
  expect(dialog).toHaveTextContent(/Start with existing list tasks/i);
  expect(onConfirm).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Accept all clear matches' }));

  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  expect(onConfirm).toHaveBeenNthCalledWith(1, {
    tier: 'clickup', projectId: 'project-1', listId: 'list-1', direction: 'push-seed',
  });
  expect(onConfirm).toHaveBeenNthCalledWith(2, {
    tier: 'clickup', projectId: 'project-2', listId: 'list-2', direction: 'pull-adopt',
  });
  expect(onComplete).toHaveBeenCalledTimes(1);
});

it('AC-ADMIA-015: preserves partial failures and retries only unresolved matches', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onConfirm = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('upstream detail'))
    .mockResolvedValueOnce(undefined);
  const onComplete = vi.fn();
  render(
    <TaskListBatchMatchReview
      open
      proposals={proposals}
      canConfirm
      onClose={onClose}
      onComplete={onComplete}
      onConfirm={onConfirm}
    />,
  );

  const dialog = screen.getByRole('dialog', { name: 'Review clear ClickUp matches' });
  await user.click(within(dialog).getByRole('radio', { name: /Start with existing list tasks/i }));
  await user.click(within(dialog).getByRole('button', { name: 'Review project connections' }));
  await user.click(within(dialog).getByRole('button', { name: 'Accept all clear matches' }));
  const failedNotice = await within(dialog).findByText(/This link was not saved/i);
  expect(failedNotice.closest('li')).toHaveTextContent('North Office');
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).toHaveBeenCalledTimes(2);

  await user.click(within(dialog).getByRole('button', { name: 'Retry failed match' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(3));
  expect(onConfirm).toHaveBeenNthCalledWith(3, {
    tier: 'clickup', projectId: 'project-2', listId: 'list-2', direction: 'pull-adopt',
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledTimes(2);
});
