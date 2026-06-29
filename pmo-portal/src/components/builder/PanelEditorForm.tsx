/**
 * PanelEditorForm — EntityFormModal-based panel editor (I4, FR-VB-031..035, OD-VB-3).
 *
 * All option lists are derived from ENTITY_WHITELIST and registry.keys() so it is
 * impossible to construct an off-whitelist QuerySpec via the UI (NFR-VB-SEC-001).
 *
 * Props:
 *   open           — whether the modal is open (owner state)
 *   initialPanel   — null (add mode) | PanelSpec (edit mode)
 *   onConfirm(p)   — called with the assembled PanelSpec when the form is submitted
 *   onClose()      — called when the modal is closed (cancel/discard)
 */
import React, { useEffect, useState } from 'react';
import {
  EntityFormModal,
  SelectField,
  TextField,
  FormGrid,
  FormSection,
  FieldError,
  type SelectOption,
} from '@/src/components/ui';
import {
  ENTITY_WHITELIST,
  VALID_FILTER_OPS,
  ValidationError,
} from '@/src/lib/viewspec/types';
import { registry } from '@/src/lib/viewspec/registry';
import type {
  PanelSpec,
  QuerySpec,
  WhitelistedEntity,
  AggregateFn,
  FilterClause,
} from '@/src/lib/viewspec/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FilterRow {
  column: string;
  op: string;
  value: string;
}

interface FormState {
  primitive: string;
  entity: WhitelistedEntity | '';
  selectedColumns: string[];
  filters: FilterRow[];
  groupBy: string;
  aggregateFn: AggregateFn | '';
  aggregateColumn: string;
  aggregateAlias: string;
  timeRangeColumn: string;
  timeRangeFrom: string;
  timeRangeTo: string;
  orderByColumn: string;
  orderByDir: 'asc' | 'desc';
  limit: string;
  label: string;
  colSpan: string;
}

function emptyForm(): FormState {
  return {
    primitive: '',
    entity: '',
    selectedColumns: [],
    filters: [],
    groupBy: '',
    aggregateFn: '',
    aggregateColumn: '',
    aggregateAlias: '',
    timeRangeColumn: '',
    timeRangeFrom: '',
    timeRangeTo: '',
    orderByColumn: '',
    orderByDir: 'asc',
    limit: '',
    label: '',
    colSpan: '',
  };
}

function panelToForm(panel: PanelSpec): FormState {
  const qs = panel.querySpec;
  return {
    primitive: panel.primitive,
    entity: qs.entity,
    selectedColumns: [...qs.select],
    filters: (qs.filters ?? []).map((f) => ({
      column: f.column,
      op: f.op,
      value: Array.isArray(f.value) ? (f.value as string[]).join(',') : String(f.value),
    })),
    groupBy: qs.groupBy ?? '',
    aggregateFn: qs.aggregate?.fn ?? '',
    aggregateColumn: qs.aggregate?.column ?? '',
    aggregateAlias: qs.aggregate?.alias ?? '',
    timeRangeColumn: qs.timeRange?.column ?? '',
    timeRangeFrom: qs.timeRange?.from ?? '',
    timeRangeTo: qs.timeRange?.to ?? '',
    orderByColumn: qs.orderBy?.column ?? '',
    orderByDir: qs.orderBy?.dir ?? 'asc',
    limit: qs.limit !== undefined ? String(qs.limit) : '',
    label: (panel.props?.label as string | undefined) ?? '',
    colSpan: panel.layout?.colSpan !== undefined ? String(panel.layout.colSpan) : '',
  };
}

// Filter ops minus date-range (date-range is only via the time-range compound field)
const FORM_FILTER_OPS: SelectOption[] = Array.from(VALID_FILTER_OPS)
  .filter((op) => op !== 'date-range')
  .map((op) => ({ value: op, label: op }));

const AGGREGATE_FNS: SelectOption[] = [
  { value: 'count', label: 'count' },
  { value: 'sum', label: 'sum' },
  { value: 'avg', label: 'avg' },
  { value: 'min', label: 'min' },
  { value: 'max', label: 'max' },
];

const DIR_OPTIONS: SelectOption[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

export interface PanelEditorFormProps {
  open: boolean;
  /** null = add mode; PanelSpec = edit mode (pre-populated) */
  initialPanel: PanelSpec | null;
  onConfirm: (panel: PanelSpec) => void;
  onClose: () => void;
}

export const PanelEditorForm: React.FC<PanelEditorFormProps> = ({
  open,
  initialPanel,
  onConfirm,
  onClose,
}) => {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // Reset or pre-populate when the modal opens
  useEffect(() => {
    if (!open) return;
    setForm(initialPanel ? panelToForm(initialPanel) : emptyForm());
    setError(null);
  }, [open, initialPanel]);

  const entityEntry =
    form.entity !== '' ? ENTITY_WHITELIST[form.entity] : null;

  // When entity changes, reset all entity-dependent fields (FR-VB-033)
  const handleEntityChange = (entity: string) => {
    setForm((prev) => ({
      ...emptyForm(),
      primitive: prev.primitive,
      entity: entity as WhitelistedEntity | '',
    }));
  };

  const toggleColumn = (col: string) => {
    setForm((prev) => ({
      ...prev,
      selectedColumns: prev.selectedColumns.includes(col)
        ? prev.selectedColumns.filter((c) => c !== col)
        : [...prev.selectedColumns, col],
    }));
  };

  const addFilter = () => {
    setForm((prev) => ({
      ...prev,
      filters: [...prev.filters, { column: '', op: 'eq', value: '' }],
    }));
  };

  const removeFilter = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== idx),
    }));
  };

  const updateFilter = (idx: number, key: keyof FilterRow, value: string) => {
    setForm((prev) => {
      const next = [...prev.filters];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, filters: next };
    });
  };

  // tasks entity: requires a project_id eq|in filter (FR-VB-032 §4, AC-VB-006)
  const tasksFilterSatisfied =
    form.entity !== 'tasks' ||
    form.filters.some(
      (f) => f.column === 'project_id' && (f.op === 'eq' || f.op === 'in'),
    );

  const isFormComplete =
    form.primitive !== '' &&
    form.entity !== '' &&
    form.selectedColumns.length > 0 &&
    tasksFilterSatisfied;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isFormComplete) return;

    // Build QuerySpec
    const filters: FilterClause[] = form.filters
      .filter((f) => f.column && f.op && f.value)
      .map((f) => ({
        column: f.column,
        op: f.op as FilterClause['op'],
        value: f.op === 'in' ? f.value.split(',').map((v) => v.trim()) : f.value,
      }));

    const qs: QuerySpec = {
      entity: form.entity as WhitelistedEntity,
      select: [...form.selectedColumns],
      ...(filters.length > 0 && { filters }),
      ...(form.groupBy && { groupBy: form.groupBy }),
      ...(form.aggregateFn && form.aggregateColumn && form.aggregateAlias && {
        aggregate: {
          fn: form.aggregateFn as AggregateFn,
          column: form.aggregateColumn,
          alias: form.aggregateAlias,
        },
      }),
      ...(form.timeRangeColumn && form.timeRangeFrom && form.timeRangeTo && {
        timeRange: {
          column: form.timeRangeColumn,
          from: form.timeRangeFrom,
          to: form.timeRangeTo,
        },
      }),
      ...(form.orderByColumn && {
        orderBy: { column: form.orderByColumn, dir: form.orderByDir },
      }),
      ...(form.limit && { limit: parseInt(form.limit, 10) }),
    };

    const id = initialPanel?.id ?? crypto.randomUUID().slice(0, 8);

    const panel: PanelSpec = {
      id,
      primitive: form.primitive,
      querySpec: qs,
      ...(form.colSpan && {
        layout: { colSpan: parseInt(form.colSpan, 10) },
      }),
      ...(form.label && {
        props: { label: form.label },
      }),
    };

    onConfirm(panel);
  };

  const primitiveOptions: SelectOption[] = registry
    .keys()
    .map((name) => ({ value: name, label: name }));

  const entityOptions: SelectOption[] = Object.keys(ENTITY_WHITELIST).map((e) => ({
    value: e,
    label: e,
  }));

  const allCols = entityEntry
    ? Array.from(entityEntry.allowedColumns).sort()
    : [];

  const groupableCols: SelectOption[] = entityEntry
    ? Array.from(entityEntry.groupableColumns)
        .sort()
        .map((c) => ({ value: c, label: c }))
    : [];

  const aggregateColOptions: SelectOption[] = (() => {
    if (!entityEntry || !form.aggregateFn) return [];
    const cols =
      form.aggregateFn === 'count'
        ? Array.from(entityEntry.allowedColumns)
        : Array.from(entityEntry.numericColumns);
    return cols.sort().map((c) => ({ value: c, label: c }));
  })();

  const dateColOptions: SelectOption[] = entityEntry
    ? Array.from(entityEntry.dateColumns)
        .sort()
        .map((c) => ({ value: c, label: c }))
    : [];

  const allowedColOptions: SelectOption[] = entityEntry
    ? Array.from(entityEntry.allowedColumns)
        .sort()
        .map((c) => ({ value: c, label: c }))
    : [];

  // Warn if $current_team is entered in any filter value
  const hasTeamToken = form.filters.some((f) => f.value === '$current_team');

  // Suppress unused import warning — ValidationError is imported for type checking
  void ValidationError;

  return (
    <EntityFormModal
      open={open}
      title={initialPanel ? 'Edit panel' : 'Add panel'}
      subtitle="Configure this panel's data source"
      submitLabel={initialPanel ? 'Update panel' : 'Add panel'}
      onSubmit={handleSubmit}
      onClose={onClose}
      submitDisabled={!isFormComplete}
      width="lg"
      errorSummary={error ? [{ fieldId: 'panel-error', message: error }] : undefined}
    >
      <FormGrid>
        {/* Primitive selector */}
        <SelectField
          label="Primitive"
          required
          value={form.primitive}
          options={[{ value: '', label: '— select a primitive —' }, ...primitiveOptions]}
          onChange={(v) => setForm((p) => ({ ...p, primitive: v }))}
        />

        {/* Entity selector */}
        <SelectField
          label="Entity"
          required
          value={form.entity}
          options={[{ value: '', label: '— select an entity —' }, ...entityOptions]}
          onChange={handleEntityChange}
        />

        {/* tasks required-filter note (FR-VB-032 §4) */}
        {form.entity === 'tasks' && (
          <div className="col-span-2">
            <FieldError>Tasks require a project filter (column: project_id, op: eq or in)</FieldError>
          </div>
        )}

        {/* Select columns — multi-checkbox (FR-VB-032 §3) */}
        {form.entity !== '' && (
          <FormSection legend="Select columns *" className="col-span-full">
            <fieldset aria-label="Select columns" className="flex flex-wrap gap-2 border-0 p-0 m-0">
              {allCols.map((col) => (
                <label key={col} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={form.selectedColumns.includes(col)}
                    onChange={() => toggleColumn(col)}
                    aria-label={col}
                  />
                  {col}
                </label>
              ))}
            </fieldset>
          </FormSection>
        )}

        {/* Filters */}
        {form.entity !== '' && (
          <FormSection legend="Filters" className="col-span-full">
            {form.filters.map((f, idx) => (
              <div key={idx} className="mb-2 flex flex-wrap items-end gap-2">
                <SelectField
                  label="Filter column"
                  value={f.column}
                  options={[
                    { value: '', label: '— column —' },
                    ...allCols.map((c) => ({ value: c, label: c })),
                  ]}
                  onChange={(v) => updateFilter(idx, 'column', v)}
                />
                <SelectField
                  label="Filter operator"
                  value={f.op}
                  options={FORM_FILTER_OPS}
                  onChange={(v) => updateFilter(idx, 'op', v)}
                />
                <TextField
                  label="Filter value"
                  value={f.value}
                  onChange={(v) => updateFilter(idx, 'value', v)}
                />
                <button
                  type="button"
                  aria-label="Remove filter"
                  onClick={() => removeFilter(idx)}
                  className="self-end pb-0.5 text-[12px] text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
            {hasTeamToken && (
              <FieldError>
                $current_team requires a teamId context at render time — it may fail at preview.
              </FieldError>
            )}
            <button
              type="button"
              aria-label="Add filter"
              onClick={addFilter}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              + Add filter
            </button>
          </FormSection>
        )}

        {/* Group by */}
        {form.entity !== '' && (
          <SelectField
            label="Group by"
            value={form.groupBy}
            options={[{ value: '', label: '— none —' }, ...groupableCols]}
            onChange={(v) => setForm((p) => ({ ...p, groupBy: v }))}
          />
        )}

        {/* Aggregate */}
        {form.entity !== '' && (
          <FormSection legend="Aggregate" className="col-span-full">
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="Aggregate function"
                value={form.aggregateFn}
                options={[{ value: '', label: '— none —' }, ...AGGREGATE_FNS]}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    aggregateFn: v as AggregateFn | '',
                    aggregateColumn: '',
                  }))
                }
              />
              {form.aggregateFn && (
                <>
                  <SelectField
                    label="Aggregate column"
                    value={form.aggregateColumn}
                    options={[{ value: '', label: '— select —' }, ...aggregateColOptions]}
                    onChange={(v) => setForm((p) => ({ ...p, aggregateColumn: v }))}
                  />
                  <TextField
                    label="Alias"
                    value={form.aggregateAlias}
                    onChange={(v) => setForm((p) => ({ ...p, aggregateAlias: v }))}
                  />
                </>
              )}
            </div>
          </FormSection>
        )}

        {/* Time range */}
        {form.entity !== '' && (
          <FormSection legend="Time range" className="col-span-full">
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="Date column"
                value={form.timeRangeColumn}
                options={[{ value: '', label: '— none —' }, ...dateColOptions]}
                onChange={(v) => setForm((p) => ({ ...p, timeRangeColumn: v }))}
              />
              {form.timeRangeColumn && (
                <>
                  <TextField
                    label="From (ISO date or token)"
                    value={form.timeRangeFrom}
                    onChange={(v) => setForm((p) => ({ ...p, timeRangeFrom: v }))}
                  />
                  <TextField
                    label="To (ISO date or token)"
                    value={form.timeRangeTo}
                    onChange={(v) => setForm((p) => ({ ...p, timeRangeTo: v }))}
                  />
                </>
              )}
            </div>
          </FormSection>
        )}

        {/* Order by */}
        {form.entity !== '' && (
          <FormSection legend="Order by" className="col-span-full">
            <div className="flex flex-wrap gap-2">
              <SelectField
                label="Order column"
                value={form.orderByColumn}
                options={[{ value: '', label: '— none —' }, ...allowedColOptions]}
                onChange={(v) => setForm((p) => ({ ...p, orderByColumn: v }))}
              />
              {form.orderByColumn && (
                <SelectField
                  label="Direction"
                  value={form.orderByDir}
                  options={DIR_OPTIONS}
                  onChange={(v) =>
                    setForm((p) => ({ ...p, orderByDir: v as 'asc' | 'desc' }))
                  }
                />
              )}
            </div>
          </FormSection>
        )}

        {/* Limit */}
        <TextField
          label="Limit (1–500)"
          value={form.limit}
          onChange={(v) => setForm((p) => ({ ...p, limit: v }))}
        />

        {/* Panel label */}
        <TextField
          label="Panel label"
          value={form.label}
          onChange={(v) => setForm((p) => ({ ...p, label: v }))}
        />

        {/* Layout colSpan */}
        <TextField
          label="Column span (1–4)"
          value={form.colSpan}
          onChange={(v) => setForm((p) => ({ ...p, colSpan: v }))}
        />
      </FormGrid>
    </EntityFormModal>
  );
};

export default PanelEditorForm;
