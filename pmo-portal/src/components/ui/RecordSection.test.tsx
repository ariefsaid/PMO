import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecordSection, RecordStack } from './RecordSection';

describe('RecordSection', () => {
  it('shows its title as an h2 heading', () => {
    render(<RecordSection title="Lines">body</RecordSection>);
    expect(screen.getByRole('heading', { level: 2, name: 'Lines' })).toBeInTheDocument();
  });

  it('puts the actions beside the heading without changing its accessible name', () => {
    render(<RecordSection title="Receipts" actions={<button>Attach</button>}>body</RecordSection>);
    expect(screen.getByRole('heading', { name: 'Receipts' })).toBeInTheDocument();
    expect(screen.getByTestId('record-section-actions')).toContainElement(screen.getByRole('button', { name: 'Attach' }));
  });

  it('pads the content to the heading inset by default', () => {
    render(<RecordSection title="Facts"><p>one</p></RecordSection>);
    const body = screen.getByText('one').parentElement!;
    expect(body).not.toHaveAttribute('data-flush');
    expect(body.className).toContain('px-[var(--panel-inset)]');
  });

  it('flush lets the content touch the panel edges', () => {
    render(<RecordSection title="Lines" flush><table><tbody><tr><td>cell</td></tr></tbody></table></RecordSection>);
    const body = screen.getByText('cell').closest('[data-flush]')!;
    expect(body).toHaveAttribute('data-flush', 'true');
    expect(body.className).toContain('p-0');
  });

  it('renders no action slot when none is given', () => {
    render(<RecordSection title="Plain">x</RecordSection>);
    expect(screen.queryByTestId('record-section-actions')).toBeNull();
  });
});

describe('RecordStack', () => {
  it('stacks panels on the section gap', () => {
    render(<RecordStack><div>a</div><div>b</div></RecordStack>);
    expect(screen.getByText('a').parentElement!.className).toContain('gap-[var(--space-section)]');
  });
});

describe('RecordHeader record-page options', () => {
  it('keeps the actions on the title row and puts notes inside the header panel', async () => {
    const { RecordHeader } = await import('./RecordHeader');
    render(<RecordHeader name="Claim" status={<span>Draft</span>} actionsOnTitleRow panelInset actions={<button>Submit</button>}><p>muted note</p></RecordHeader>);
    const zone = screen.getByTestId('record-header-actions').parentElement!;
    expect(zone.className).not.toMatch(/(^| )w-full/);
    expect(screen.getByTestId('record-header-notes')).toContainElement(screen.getByText('muted note'));
    expect(screen.getByTestId('record-header').className).toContain('p-[var(--panel-inset)]');
  });
});
