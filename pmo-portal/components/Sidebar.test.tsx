import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Sidebar from './Sidebar';

let effectiveRole = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: 'Admin', canImpersonate: effectiveRole === 'Admin' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', full_name: 'Test User', org_id: 'org-1' }, role: effectiveRole }),
}));

const renderNav = () => render(<MemoryRouter><Sidebar /></MemoryRouter>);

describe('Sidebar role-based nav', () => {
  it('PM sees Projects, Sales Pipeline, Procurement, Timesheets (AC-AUTH-003)', () => {
    effectiveRole = 'Project Manager';
    renderNav();
    for (const name of ['Projects', 'Sales Pipeline', 'Procurement', 'Timesheets']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('Engineer sees Dashboard/Projects/Timesheets/Tasks but not restricted nav (AC-AUTH-009)', () => {
    effectiveRole = 'Engineer';
    renderNav();
    for (const name of ['Dashboard', 'Projects', 'Timesheets', 'Tasks']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    for (const name of ['Sales Pipeline', 'Procurement', 'Companies', 'Reports', 'Administration']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  it('Admin sees Administration + Sales Pipeline; viewing as Engineer collapses the nav (AC-AUTH-010)', () => {
    effectiveRole = 'Admin';
    const { unmount } = renderNav();
    expect(screen.getByRole('link', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Pipeline' })).toBeInTheDocument();
    unmount();
    effectiveRole = 'Engineer'; // simulate "view as Engineer" — nav is driven by effectiveRole
    renderNav();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  });

  it('non-Admin (Finance) renders no nav requiring Admin (AC-AUTH-011)', () => {
    effectiveRole = 'Finance';
    renderNav();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
  });
});
