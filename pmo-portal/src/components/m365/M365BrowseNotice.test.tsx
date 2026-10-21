import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { M365BrowseNotice } from './M365BrowseNotice';
describe('M365BrowseNotice AC-M365DOC-035', () => {
  it('uses reviewed reconnect copy without rendering raw identifiers or error bodies', () => {
    render(<M365BrowseNotice code="CONNECTION_STALE" onReconnect={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The Microsoft 365 connection expired. Reconnect to link more documents.');
    expect(screen.getByRole('button', { name: 'Reconnect Microsoft 365' })).toBeInTheDocument();
    expect(screen.queryByText(/oid|tenant|raw-synthetic/)).not.toBeInTheDocument();
  });
  it('uses a generic safe message for unknown errors', () => {
    render(<M365BrowseNotice code="raw-synthetic-error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Microsoft could not load this location');
  });
});
