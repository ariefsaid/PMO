import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataTable, type Column } from '../DataTable';
import { ProjectNameLink } from '../ProjectNameLink';
import { Breadcrumb } from '@/src/components/shell/Breadcrumb';
import { CardLink } from '@/src/components/dashboard/hub/company/OverviewCards';

/**
 * AC-HIT-24-001 (#2135, WCAG 2.2 2.5.8) — compact text controls reach a 24x24 hit area at ANY
 * pointer without changing their visible size. jsdom has no layout, so the proof is split: the
 * `.hit-area-24` rule is a 24px overlay in index.css, and every named element carries the class.
 */
const css = readFileSync(join(process.cwd(), 'index.css'), 'utf8');
const HIT = 'hit-area-24';

describe('AC-HIT-24-001 the .hit-area-24 rule', () => {
  it('is an unconditional (no pointer media query) centered 24px overlay that is not the element box', () => {
    const rule = /\.hit-area-24::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-width:\s*24px/);
    expect(rule).toMatch(/min-height:\s*24px/);
    expect(rule).toMatch(/position:\s*absolute/);
    expect(css).toMatch(/\.hit-area-24\s*\{\s*position:\s*relative;\s*\}/);
    const at = css.indexOf('.hit-area-24::before');
    const before = css.slice(Math.max(0, at - 400), at);
    expect(before.lastIndexOf('@media')).toBeLessThan(before.lastIndexOf('}'));
  });
});

type Row = { id: string; name: string };
const rows: Row[] = [{ id: 'p1', name: 'Alpha' }];
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name, sortKey: 'name' }];

describe('AC-HIT-24-001 elements carry the hit area', () => {
  it('table sort header button', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} sort={{ key: 'name', dir: 'asc' }} onSort={() => {}} />);
    const th = screen.getByRole('columnheader', { name: /Name/ });
    expect(within(th).getByRole('button')).toHaveClass(HIT);
  });

  it('table row "Open <name>" button', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onActivate={() => {}} rowLabel={(r) => `Open ${r.name}`} />);
    expect(screen.getByRole('button', { name: 'Open Alpha' })).toHaveClass(HIT);
  });

  it('breadcrumb parent crumb (button and link forms)', () => {
    render(
      <>
        <Breadcrumb parts={[{ label: 'Projects', onClick: () => {} }, { label: 'Alpha' }]} />
        <Breadcrumb parts={[{ label: 'Sales', href: '/sales' }, { label: 'Deal' }]} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveClass(HIT);
    expect(screen.getByRole('link', { name: 'Sales' })).toHaveClass(HIT);
  });

  it('project name link', () => {
    render(<MemoryRouter><ProjectNameLink projectId="p1" name="Alpha" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open Alpha' })).toHaveClass(HIT);
  });

  it('dashboard card link ("Open projects")', () => {
    render(<MemoryRouter><CardLink to="/projects">Open projects</CardLink></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Open projects/ })).toHaveClass(HIT);
  });

  // Elements inside larger components: asserted on their class literals.
  const literals: Array<[string, string, string]> = [
    ['project record fix link', 'pages/project-detail/ProjectBlocks.tsx', 'className="hit-area-24 font-semibold text-primary-text hover:underline">{children}</Link>'],
    ['project record blocking-task link', 'pages/project-detail/ProjectBlocks.tsx', 'className="hit-area-24 font-semibold text-primary-text hover:underline">{task.name}'],
    ['procurement row expand toggle', 'pages/procurement/ProcurementListRow.tsx', "'hit-area-24 [&_svg]:transition-transform'"],
    ['accounting snapshot project link', 'src/components/dashboard/AccountingSnapshotsSection.tsx', 'className="hit-area-24 font-medium'],
  ];
  for (const [name, file, literal] of literals) {
    it(name, () => {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain(literal);
    });
  }
});
