import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import React, { useEffect } from 'react';
import { projects } from '../data/mockData';
import ProjectDetails from '../pages/ProjectDetails';

// F-1 (baseline §9): useState ran AFTER an early `return <Navigate/>`, making a hook
// conditional. React surfaces this as a console.error: "Rendered more hooks than during
// the previous render" / "change in the order of Hooks". This test fails (red) while the
// hook is below the guard and passes (green) once all hooks are hoisted above it. AC-005.
afterEach(() => vi.restoreAllMocks());

/** Navigates to a new projectId after mount to exercise re-render of the same
 *  ProjectDetails component instance (same element in Routes → same fiber). */
function NavDriver({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(`/projects/${to}`, { replace: true });
  }, [navigate, to]);
  return null;
}

function renderAt(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetails />} />
        <Route path="/projects" element={<div>projects-list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectDetails hooks order (F-1)', () => {
  it('renders a valid project without a React hooks-order error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const validId = projects[0].id;
    expect(() => renderAt(validId)).not.toThrow();
    const hooksOrderError = errorSpy.mock.calls.some(args =>
      String(args[0]).match(/hook|order of Hooks|Rendered more|Rendered fewer/i),
    );
    expect(hooksOrderError).toBe(false);
  });

  it('does not trigger hooks-order error when navigating from invalid to valid project id', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const validId = projects[0].id;

    // Start on INVALID id (early-return path: fewer hooks rendered).
    // Then NavDriver immediately navigates to the valid id (more hooks path).
    // If useState is still below the guard, React fires a hooks-order console.error.
    act(() => {
      render(
        <MemoryRouter initialEntries={['/projects/INVALID']}>
          <NavDriver to={validId} />
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectDetails />} />
            <Route path="/projects" element={<div>projects-list</div>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const hooksOrderError = errorSpy.mock.calls.some(args =>
      String(args[0]).match(/hook|order of Hooks|Rendered more|Rendered fewer/i),
    );
    expect(hooksOrderError).toBe(false);
  });
});
