/**
 * AC-JR-W1-08: TimesheetGrid read-only project name links (desktop + mobile);
 * editable branch stays plain text (no link while editing).
 *
 * Task T08 — adds optional `projectId?: string` to TimesheetGridRow and
 * renders <ProjectNameLink> in the read-only branches only.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { TimesheetGrid, type TimesheetGridRow, type TimesheetDay } from '../TimesheetGrid';

const days: TimesheetDay[] = [
  { label: 'Mon', dateNum: '2', weekend: false },
  { label: 'Tue', dateNum: '3', weekend: false },
  { label: 'Wed', dateNum: '4', weekend: false },
  { label: 'Thu', dateNum: '5', weekend: false },
  { label: 'Fri', dateNum: '6', weekend: false },
  { label: 'Sat', dateNum: '7', weekend: true },
  { label: 'Sun', dateNum: '8', weekend: true },
];

/**
 * Stubs window.matchMedia so useIsDesktop() resolves to the given breakpoint.
 * isDesktop=true → (min-width:768px) reports matches:true → desktop branch.
 */
function mockViewport(isDesktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

const rowsWithProjectId: TimesheetGridRow[] = [
  { id: 'p1', project: 'Bridge Construction', code: 'PRJ-001', hours: [8, 8, 0, 0, 0, 0, 0], projectId: 'p1' },
  { id: 'p2', project: 'No Link Project', code: null, hours: [0, 4, 0, 0, 0, 0, 0] },
];

describe('AC-JR-W1-08: TimesheetGrid read-only project name → ProjectNameLink (desktop)', () => {
  it('AC-JR-W1-08: read-only desktop — project name with projectId is a link to /projects/:id', () => {
    mockViewport(true);
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={rowsWithProjectId} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Open Bridge Construction' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/projects/p1');
  });

  it('AC-JR-W1-08: read-only desktop — project name without projectId renders as inert text (no link)', () => {
    mockViewport(true);
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={rowsWithProjectId} />
      </MemoryRouter>,
    );
    // "No Link Project" has no projectId — should be inert text, not a link
    expect(screen.queryByRole('link', { name: 'Open No Link Project' })).toBeNull();
    expect(screen.getByText('No Link Project')).toBeInTheDocument();
  });

  it('AC-JR-W1-08: editable desktop — project name stays plain text even when projectId is present', () => {
    mockViewport(true);
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={rowsWithProjectId} editable />
      </MemoryRouter>,
    );
    // No link rendered in editable mode for the project with projectId
    expect(screen.queryByRole('link', { name: 'Open Bridge Construction' })).toBeNull();
    // The project name still appears as plain text
    expect(screen.getByText('Bridge Construction')).toBeInTheDocument();
  });
});

describe('AC-JR-W1-08: TimesheetGrid read-only project name → ProjectNameLink (mobile)', () => {
  it('AC-JR-W1-08: read-only mobile — project name with projectId is a link to /projects/:id', () => {
    mockViewport(false);
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={rowsWithProjectId} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Open Bridge Construction' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/projects/p1');
  });

  it('AC-JR-W1-08: read-only mobile — project name without projectId renders as inert text (no link)', () => {
    mockViewport(false);
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={rowsWithProjectId} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Open No Link Project' })).toBeNull();
    expect(screen.getByText('No Link Project')).toBeInTheDocument();
  });

  it('AC-JR-W1-08: editable mobile — project name stays plain text even when projectId is present', () => {
    mockViewport(false);
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={rowsWithProjectId} editable />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'Open Bridge Construction' })).toBeNull();
    expect(screen.getByText('Bridge Construction')).toBeInTheDocument();
  });
});

describe('TimesheetGridRow.projectId type compatibility', () => {
  it('AC-JR-W1-08: rows without projectId field remain valid (optional, no regression)', () => {
    mockViewport(true);
    // Rows without projectId — these are the existing shape used across the codebase
    const legacyRows: TimesheetGridRow[] = [
      { id: 'r1', project: 'Legacy Project', code: 'L001', hours: [8, 0, 0, 0, 0, 0, 0] },
    ];
    render(
      <MemoryRouter>
        <TimesheetGrid days={days} rows={legacyRows} />
      </MemoryRouter>,
    );
    // No link is rendered (projectId absent), project name is inert text
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Legacy Project')).toBeInTheDocument();
  });
});
