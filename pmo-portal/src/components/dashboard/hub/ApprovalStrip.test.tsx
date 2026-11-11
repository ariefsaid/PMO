import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ApprovalStrip } from './ApprovalStrip';
import type { AttentionItem } from './AttentionList';

const items: AttentionItem[] = [
  {
    id: 'approvals',
    tone: 'warn',
    icon: 'check',
    count: 5,
    label: 'waiting for your approval',
    href: '/approvals',
  },
];

describe('ApprovalStrip', () => {
  it('renders each approval summary as a link to its work page', () => {
    render(<MemoryRouter><ApprovalStrip items={items} /></MemoryRouter>);

    const approval = screen.getByRole('link', { name: /5 waiting for your approval/i });
    expect(approval).toHaveAttribute('href', '/approvals');
  });

  it('renders nothing when there are no approval items', () => {
    const { container } = render(<MemoryRouter><ApprovalStrip items={[]} /></MemoryRouter>);

    expect(container).toBeEmptyDOMElement();
  });
});
