import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WidgetSlot } from './WidgetSlot';

function renderSlot(widget: unknown) {
  return render(
    <MemoryRouter>
      <WidgetSlot widget={widget} />
    </MemoryRouter>,
  );
}

describe('WidgetSlot (FR-ATC-004/005/006, NFR-ATC-SEC-002)', () => {
  it('AC-ATC-003 client re-validates, renders text fallback on failure', () => {
    const malformed = {
      kind: 'data_table',
      columns: [{ key: 'n', label: 'N' }],
      rows: 'nope',
    } as unknown;

    expect(() => renderSlot(malformed)).not.toThrow();
    expect(screen.getByText(/couldn.t be displayed/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('AC-ATC-004 unregistered kind renders text fallback, no iframe/eval', () => {
    const unregistered = { kind: 'iframe_app', src: 'javascript:alert(1)' } as unknown;

    renderSlot(unregistered);

    expect(screen.getByText(/couldn.t be displayed/i)).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText('javascript:alert(1)')).toBeNull();
  });

  it('renders the mapped primitive for a valid widget payload (happy path)', () => {
    renderSlot({
      kind: 'data_table',
      columns: [{ key: 'name', label: 'Project' }],
      rows: [{ name: 'Alpha' }],
    });

    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
  });
});
