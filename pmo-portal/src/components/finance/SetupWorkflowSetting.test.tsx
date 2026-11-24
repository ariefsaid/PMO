import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ isAdmin: true, enabled: false, isLoading: false, isError: false, isSaving: false, setEnabled: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.isAdmin }));
vi.mock('@/src/hooks/useSetupWorkflows', () => ({ useSetupWorkflows: () => ({
  enabled: state.enabled, isLoading: state.isLoading, isError: state.isError, isSaving: state.isSaving, setEnabled: state.setEnabled,
}) }));

import { SetupWorkflowSetting } from './SetupWorkflowSetting';

beforeEach(() => {
  state.isAdmin = true;
  state.enabled = false;
  state.isLoading = false;
  state.isError = false;
  state.isSaving = false;
  state.setEnabled.mockReset();
});

describe('setup workflow setting', () => {
  it('AC-SETUP-001 shows an Admin-controlled switch and persists the requested value', () => {
    render(<SetupWorkflowSetting />);
    const toggle = screen.getByRole('switch', { name: 'Enable setup workflows' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(state.setEnabled).toHaveBeenCalledWith(true);
  });

  it('AC-SETUP-001 hides the control from non-Admins', () => {
    state.isAdmin = false;
    render(<SetupWorkflowSetting />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('does not permit changing a setting while it is loading or saving and reports read failures', () => {
    state.isLoading = true;
    state.isError = true;
    render(<SetupWorkflowSetting />);
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/Could not load/);
  });
});
