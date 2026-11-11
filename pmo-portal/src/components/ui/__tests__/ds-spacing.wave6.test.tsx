import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../StatusPill';
import { Card } from '../Card';
import { PageHeader } from '../PageHeader';
import { SectionHeader } from '../SectionHeader';
import { StatTiles } from '../StatTiles';
import { Toolbar } from '../DataTable';
import { Drawer } from '../Drawer';
import { overlayBodyClassName, overlayFooterClassName } from '../OverlaySurface';

describe('DS spacing normalization', () => {
  it('AC-W6-H3: count Badge uses px-2 (not the arbitrary px-[7px])', () => {
    render(<Badge>4</Badge>);
    const b = screen.getByText('4');
    expect(b.className).toContain('px-2');
    expect(b.className).not.toContain('px-[7px]');
  });

  it('PageHeader uses shared page rhythm and content inset tokens', () => {
    const { container } = render(<PageHeader name="Project" />);
    const header = container.firstElementChild;

    expect(header?.className).toContain('mb-[var(--space-section)]');
    expect(header?.className).toContain('px-[var(--space-content-inset)]');
    expect(header?.className).toContain('py-[var(--space-content-inset)]');
  });

  it('SectionHeader keeps its title group on the shared group rhythm', () => {
    const { container } = render(<SectionHeader title="Overview" />);
    const header = container.firstElementChild;

    expect(header?.className).toContain('mb-[var(--space-group)]');
    expect(header?.className).toContain('gap-[var(--space-group)]');
  });

  it('bare Card spaces its sibling groups on the shared group rhythm', () => {
    const { container } = render(<Card variant="bare"><span>One</span><span>Two</span></Card>);

    expect(container.firstElementChild?.className).toContain('space-y-[var(--space-group)]');
  });

  it('bare StatTiles and toolbars use the shared inset and group roles', () => {
    const { container } = render(
      <>
        <StatTiles variant="bare" tiles={[{ label: 'Projects', value: '4' }]} />
        <Toolbar standalone>Filters</Toolbar>
      </>,
    );
    const [tiles, toolbar] = Array.from(container.children);

    expect(tiles.className).toContain('gap-[var(--space-group)]');
    expect(toolbar.className).toContain('px-[var(--space-content-inset)]');
    expect(toolbar.className).toContain('py-2');
    expect(toolbar.className).toContain('mb-[var(--space-group)]');
  });

  it('drawers and modal overlays use the shared content inset for body and footer', () => {
    const { container } = render(
      <>
        <Drawer open title="Details" onClose={() => undefined} footer={<button type="button">Done</button>}>
          <p>Drawer body</p>
        </Drawer>
        <div className={overlayBodyClassName} data-testid="overlay-body" />
        <div className={overlayFooterClassName} data-testid="overlay-footer" />
      </>,
    );
    const drawerBody = screen.getByText('Drawer body').parentElement;
    const drawerFooter = screen.getByRole('button', { name: 'Done' }).parentElement;

    expect(drawerBody?.className).toContain('px-[var(--space-content-inset)]');
    expect(drawerBody?.className).toContain('py-[var(--space-content-inset)]');
    expect(drawerFooter?.className).toContain('px-[var(--space-content-inset)]');
    expect(container.querySelector('[data-testid="overlay-body"]')?.className).toContain('px-[var(--space-content-inset)]');
    expect(container.querySelector('[data-testid="overlay-footer"]')?.className).toContain('px-[var(--space-content-inset)]');
  });
});
