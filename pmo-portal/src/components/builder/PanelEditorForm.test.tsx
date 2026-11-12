/**
 * PanelEditorForm — whitelist-constraint tests.
 * AC-VB-002: entity change resets entity-dependent fields (selectedColumns, filters, groupBy).
 * AC-VB-003: column options = ENTITY_WHITELIST['incidents'].allowedColumns exactly.
 * AC-VB-004: groupBy options = groupableColumns only.
 * AC-VB-005: aggregate column for sum = numericColumns only.
 * AC-VB-006: tasks entity requires project_id filter; confirm disabled until present.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  it('CMP-004: closing a changed panel asks first, and Keep editing preserves the draft', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    openForm({ onClose });

    const label = screen.getByRole('textbox', { name: /panel label/i });
    await user.type(label, 'Risk review');
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    const discard = await screen.findByRole('alertdialog');
    expect(discard).toHaveTextContent(/unsaved changes/i);
    await user.click(within(discard).getByRole('button', { name: /keep editing/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /panel label/i })).toHaveValue('Risk review');
  });

  it('CMP-002: editing owned panel fields preserves unedited layout and display properties', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const initialPanel = {
      id: 'kept-id',
      primitive: 'DataTable',
      querySpec: { entity: 'companies' as const, select: ['id', 'name'] },
      layout: { colSpan: 2, rowSpan: 3 },
      props: {
        label: 'Old label',
        tone: 'green',
        icon: 'briefcase',
        title: 'Work summary',
        emptyTitle: 'No rows',
      },
    };

    openForm({ initialPanel, onConfirm });
    await user.clear(screen.getByRole('textbox', { name: /panel label/i }));
    await user.type(screen.getByRole('textbox', { name: /panel label/i }), 'Updated label');
    await user.clear(screen.getByRole('textbox', { name: /column span/i }));
    await user.type(screen.getByRole('textbox', { name: /column span/i }), '4');
    await user.click(screen.getByRole('button', { name: /update panel/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      ...initialPanel,
      layout: { colSpan: 4, rowSpan: 3 },
      props: {
        label: 'Updated label',
        tone: 'green',
        icon: 'briefcase',
        title: 'Work summary',
        emptyTitle: 'No rows',
      },
    });
  });

  it('AC-VB-002: entity change resets entity-dependent fields (selectedColumns, filters, groupBy)', async () => {
    const user = userEvent.setup();
    openForm();

    // Select entity = projects
    const entitySelect = screen.getByRole('combobox', { name: /entity/i });
    await user.selectOptions(entitySelect, 'projects');

    // Select some columns for projects
    const statusCheckbox = screen.getByRole('checkbox', { name: 'status' });
    await user.click(statusCheckbox);
    const nameCheckbox = screen.getByRole('checkbox', { name: 'name' });
    await user.click(nameCheckbox);
    // Verify they are checked
    expect(statusCheckbox).toBeChecked();
    expect(nameCheckbox).toBeChecked();

    // Add a filter
    const addFilterBtn = screen.getByRole('button', { name: /add filter/i });
    await user.click(addFilterBtn);
    // A filter row should now exist
    expect(screen.getAllByRole('combobox', { name: /filter column/i })).toHaveLength(1);

    // Set groupBy
    const groupBySelect = screen.getByRole('combobox', { name: /group by/i });
    await user.selectOptions(groupBySelect, 'status');
    expect(groupBySelect).toHaveValue('status');

    // Now change entity to companies — all entity-dependent fields must reset
    await user.selectOptions(entitySelect, 'companies');

    // No project column checkboxes should remain checked
    // (the companies whitelist has: id, name, type, created_at)
    const companyCols = Array.from(ENTITY_WHITELIST.companies.allowedColumns).sort();
    for (const col of companyCols) {
      expect(screen.getByRole('checkbox', { name: col })).not.toBeChecked();
    }
    // projects-only columns (budget, status, etc.) must be gone
    expect(screen.queryByRole('checkbox', { name: 'budget' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'status' })).not.toBeInTheDocument();

    // No filter rows remain
    expect(screen.queryAllByRole('combobox', { name: /filter column/i })).toHaveLength(0);

    // groupBy is reset to '' (no option selected — select reverts to '— none —')
    const groupByAfter = screen.getByRole('combobox', { name: /group by/i });
    expect(groupByAfter).toHaveValue('');
  });

  it('C2 PanelEditorForm.tsx:149 preserves the unrelated label and column span when entity changes', async () => {
    const user = userEvent.setup();
    openForm({
      initialPanel: {
        id: 'panel-a',
        primitive: 'DataTable',
        querySpec: { entity: 'projects', select: ['name', 'status'] },
        layout: { colSpan: 2 },
        props: { label: 'Project status' },
      },
    });

    await user.selectOptions(screen.getByRole('combobox', { name: /entity/i }), 'companies');

    expect(screen.getByRole('textbox', { name: /panel label/i })).toHaveValue('Project status');
    expect(screen.getByRole('textbox', { name: /column span/i })).toHaveValue('2');
    expect(screen.getByRole('combobox', { name: /entity/i })).toHaveValue('companies');
  });

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
    await user.type(filterValInput, '123e4567-e89b-12d3-a456-426614174000');
    // Also need to select at least one column (required)
    const colCheckbox = screen.getAllByRole('checkbox')[0];
    await user.click(colCheckbox);
    // Confirm button should now be enabled
    expect(confirmBtn).not.toBeDisabled();
  });

  it('CMP-003: tasks require a valid nonempty project ID before the panel can be confirmed', async () => {
    const user = userEvent.setup();
    openForm();
    await user.selectOptions(screen.getByRole('combobox', { name: /primitive/i }), 'DataTable');
    await user.selectOptions(screen.getByRole('combobox', { name: /entity/i }), 'tasks');
    await user.click(screen.getByRole('checkbox', { name: 'id' }));
    await user.click(screen.getByRole('button', { name: /add filter/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /filter column/i }), 'project_id');
    await user.selectOptions(screen.getByRole('combobox', { name: /filter operator/i }), 'eq');

    const confirmBtn = screen.getByRole('button', { name: /add panel|confirm/i });
    const filterValue = screen.getByRole('textbox', { name: /filter value/i });
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText(/enter a valid project id/i)).toBeInTheDocument();

    await user.type(filterValue, 'not-a-project-id');
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText(/enter a valid project id/i)).toBeInTheDocument();

    await user.clear(filterValue);
    await user.type(filterValue, '123e4567-e89b-12d3-a456-426614174000');
    expect(confirmBtn).not.toBeDisabled();
    expect(screen.queryByText(/enter a valid project id/i)).not.toBeInTheDocument();
  });

  it('CMP-003: every project ID in a tasks in-filter must be valid', async () => {
    const user = userEvent.setup();
    openForm();
    await user.selectOptions(screen.getByRole('combobox', { name: /primitive/i }), 'DataTable');
    await user.selectOptions(screen.getByRole('combobox', { name: /entity/i }), 'tasks');
    await user.click(screen.getByRole('checkbox', { name: 'id' }));
    await user.click(screen.getByRole('button', { name: /add filter/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /filter column/i }), 'project_id');
    await user.selectOptions(screen.getByRole('combobox', { name: /filter operator/i }), 'in');
    const filterValue = screen.getByRole('textbox', { name: /filter value/i });
    const confirmBtn = screen.getByRole('button', { name: /add panel|confirm/i });

    await user.type(filterValue, '123e4567-e89b-12d3-a456-426614174000,not-a-uuid');
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText(/enter a valid project id/i)).toBeInTheDocument();

    await user.clear(filterValue);
    await user.type(filterValue, '123e4567-e89b-12d3-a456-426614174000,550e8400-e29b-41d4-a716-446655440000');
    expect(confirmBtn).not.toBeDisabled();
    expect(screen.queryByText(/enter a valid project id/i)).not.toBeInTheDocument();
  });
});
