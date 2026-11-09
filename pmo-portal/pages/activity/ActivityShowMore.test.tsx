import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityShowMore } from './ActivityShowMore';

const props = { isFetchingNextPage: false, onShowMore: vi.fn() };

describe('#1990 ActivityShowMore', () => {
  it('renders nothing for a timeline that fits on the first page', () => {
    const { container } = render(<ActivityShowMore {...props} shown={3} hasNextPage={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how many are shown and offers Show more while older activity exists', async () => {
    const onShowMore = vi.fn();
    render(<ActivityShowMore {...props} onShowMore={onShowMore} shown={20} hasNextPage />);
    expect(screen.getByTestId('activity-shown-count')).toHaveTextContent('Showing the 20 most recent');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onShowMore).toHaveBeenCalledTimes(1);
  });

  it('drops the button once everything is loaded, keeping the count', () => {
    render(<ActivityShowMore {...props} shown={37} hasNextPage={false} />);
    expect(screen.getByTestId('activity-shown-count')).toHaveTextContent('Showing all 37');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
