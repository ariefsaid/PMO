/**
 * PanelEditorForm — whitelist-constraint tests.
 * AC-VB-003: column options = ENTITY_WHITELIST['incidents'].allowedColumns exactly.
 * AC-VB-004: groupBy options = groupableColumns only.
 * AC-VB-005: aggregate column for sum = numericColumns only.
 * AC-VB-006: tasks entity requires project_id filter; confirm disabled until present.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', org_id: 'org1' },
    role: 'Admin',
    session: null,
    loading: false,
    profileError: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import PanelEditorForm from '@/src/components/builder/PanelEditorForm';
import { ENTITY_WHITELIST } from '@/src/lib/viewspec/types';

const noop = () => {};

function openForm(props?: Partial<React.ComponentProps<typeof PanelEditorForm>>) {
  return render(
    <PanelEditorForm
      open={true}
      initialPanel={null}
      onConfirm={noop}
      onClose={noop}
      {...props}
    />,
  );
}

describe('PanelEditorForm — whitelist constraints', () => {
  it('AC-VB-003: incidents column options equal exactly ENTITY_WHITELIST["incidents"].allowedColumns', async () => {
    const user = userEvent.setup();
    openForm();
    // Select entity = incidents
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'incidents');
    // All expected column checkboxes should be present; no extra ones
    const allowed = Array.from(ENTITY_WHITELIST.incidents.allowedColumns).sort();
    for (const col of allowed) {
      // Use exact match to avoid /id/i matching incident_date or project_id
      expect(screen.getByRole('checkbox', { name: col })).toBeInTheDocument();
    }
    // Ensure no column outside the set is offered (sample: a definitely-absent col)
    expect(screen.queryByRole('checkbox', { name: 'budget' })).not.toBeInTheDocument();
  });

  it('AC-VB-004: groupBy options for projects = groupableColumns only (status, client_id, project_manager_id)', async () => {
    const user = userEvent.setup();
    openForm();
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'projects');
    const groupBySelect = screen.getByRole('combobox', { name: /group by/i });
    // Only groupable columns should appear as options
    const groupable = Array.from(ENTITY_WHITELIST.projects.groupableColumns);
    const options = Array.from(groupBySelect.querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options.sort()).toEqual([...groupable].sort());
    // name and budget are allowedColumns but NOT groupable
    expect(options).not.toContain('name');
    expect(options).not.toContain('budget');
  });

  it('AC-VB-005: aggregate column for sum function on projects = numericColumns only', async () => {
    const user = userEvent.setup();
    openForm();
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'projects');
    const fnSelect = screen.getByRole('combobox', { name: /aggregate function/i });
    await user.selectOptions(fnSelect, 'sum');
    const colSelect = screen.getByRole('combobox', { name: /aggregate column/i });
    const numeric = Array.from(ENTITY_WHITELIST.projects.numericColumns);
    const options = Array.from(colSelect.querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options.sort()).toEqual([...numeric].sort());
    expect(options).not.toContain('name');
    expect(options).not.toContain('status');
    expect(options).not.toContain('id');
  });

  it('AC-VB-006: tasks entity shows required-filter note; confirm disabled until project_id eq/in filter added', async () => {
    const user = userEvent.setup();
    openForm();
    // Select a primitive first (required for isFormComplete)
    const primitiveSelect = screen.getByRole('combobox', { name: /primitive/i });
    await user.selectOptions(primitiveSelect, 'DataTable');
    // Select tasks entity
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'tasks');
    // Note must be visible
    expect(screen.getByText(/tasks require a project filter/i)).toBeInTheDocument();
    // The form submit/confirm should be disabled (no filter yet + no columns)
    const confirmBtn = screen.getByRole('button', { name: /add panel|confirm/i });
    expect(confirmBtn).toBeDisabled();
    // Add a filter on project_id with op eq
    const addFilterBtn = screen.getByRole('button', { name: /add filter/i });
    await user.click(addFilterBtn);
    const filterColSelect = screen.getAllByRole('combobox', { name: /filter column/i })[0];
    await user.selectOptions(filterColSelect, 'project_id');
    const filterOpSelect = screen.getAllByRole('combobox', { name: /filter operator/i })[0];
    await user.selectOptions(filterOpSelect, 'eq');
    const filterValInput = screen.getAllByRole('textbox', { name: /filter value/i })[0];
    await user.type(filterValInput, 'proj-123');
    // Also need to select at least one column (required)
    const colCheckbox = screen.getAllByRole('checkbox')[0];
    await user.click(colCheckbox);
    // Confirm button should now be enabled
    expect(confirmBtn).not.toBeDisabled();
  });
});
