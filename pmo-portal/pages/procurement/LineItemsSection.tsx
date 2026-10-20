import React, { useState } from 'react';
import {
  Card, CardHead, CardPad, Button, Icon, ConfirmDialog, FieldError, Combobox, DataTable,
  useMoneyInputMask,
  type Column,
} from '@/src/components/ui';
import {
  formatCurrencyAuto, formatMoneyInputValue, moneyInputErrorKind, numberSymbols, parseMoneyInputAtScale,
} from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';
import type { ComboboxOption } from '@/src/components/ui/Combobox';

export interface ItemDraft { name: string; description?: string; quantity: string; rate: string }
const EMPTY_DRAFT: ItemDraft = { name: '', quantity: '', rate: '' };
function num(v: string): number { return parseMoneyInputAtScale(v, 2) ?? 0; }
function describeFormatError(label: string, locale = getNumberLocale()): string {
  const { decimal, group } = numberSymbols(locale);
  const example = formatMoneyInputValue(1234.56, locale);
  return `${label} must use "${group}" to group thousands and "${decimal}" for decimals — for example ${example}.`;
}
function validateLineNum(raw: string, label: string): string | undefined {
  if (!raw.trim()) return `${label} is required.`;
  const n = parseMoneyInputAtScale(raw, 2);
  if (n !== null && n > 0) return undefined;
  if (moneyInputErrorKind(raw, 2) === 'format') return describeFormatError(label);
  return `${label} must be greater than 0 with no more than 2 decimal places.`;
}
function parseRate(raw: string): number | null {
  const n = parseMoneyInputAtScale(raw, 2);
  return n !== null && n > 0 ? n : null;
}
function validateRate(raw: string): string | undefined {
  if (!raw.trim()) return 'Unit price is required.';
  if (parseRate(raw) !== null) return undefined;
  if (moneyInputErrorKind(raw, 2) === 'format') return describeFormatError('Unit price');
  return 'Unit price must be greater than 0 with no more than 2 decimal places.';
}
interface LineItemErrors { quantity?: string; rate?: string }
export interface LineItemsSectionProps {
  items: ProcurementItemRow[];
  editable: boolean;
  onAdd: (input: { name: string; quantity: number; rate: number; description?: string }) => Promise<unknown>;
  onUpdate: (id: string, patch: { name: string; quantity: number; rate: number; description?: string }) => Promise<unknown>;
  erpItems?: { loadOptions: () => Promise<ComboboxOption[]> };
  onDelete: (id: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  busy?: boolean;
  currency: string;
}
const CellInput: React.FC<React.ComponentPropsWithRef<'input'> & { numeric?: boolean }> = ({ numeric, className = '', ...rest }) => (
  <input {...rest} type="text" inputMode={numeric ? 'decimal' : undefined}
    className={'h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ' + (numeric ? 'tabular text-right ' : '') + className} />
);

export const LineItemsSection: React.FC<LineItemsSectionProps> = ({ items, editable, onAdd, onUpdate, onDelete, onError, busy, currency, erpItems }) => {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [addErrors, setAddErrors] = useState<LineItemErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [editErrors, setEditErrors] = useState<LineItemErrors>({});
  const [deleteTarget, setDeleteTarget] = useState<ProcurementItemRow | null>(null);
  const addRateMask = useMoneyInputMask(draft.rate, (rate) => { setDraft((d) => ({ ...d, rate })); setAddErrors((prev) => ({ ...prev, rate: undefined })); });
  const editRateMask = useMoneyInputMask(editDraft.rate, (rate) => { setEditDraft((d) => ({ ...d, rate })); setEditErrors((prev) => ({ ...prev, rate: undefined })); });
  const total = items.reduce((sum, it) => sum + Number(it.amount ?? 0), 0);

  const submitAdd = async () => {
    if (!draft.name.trim()) return;
    const quantityError = validateLineNum(draft.quantity, 'Quantity');
    const rateError = validateRate(draft.rate);
    const rate = parseRate(draft.rate);
    if (quantityError || rateError || rate === null) { setAddErrors({ quantity: quantityError, rate: rateError }); return; }
    setAddErrors({});
    try {
      await onAdd({ name: draft.name.trim(), quantity: num(draft.quantity), rate, ...(erpItems ? { description: draft.description?.trim() ?? '' } : {}) });
      setDraft(EMPTY_DRAFT);
    } catch (err) { onError(err); }
  };
  const startEdit = (it: ProcurementItemRow) => {
    setEditingId(it.id);
    setEditDraft({ name: it.name, description: it.description ?? '', quantity: formatMoneyInputValue(Number(it.quantity)), rate: formatMoneyInputValue(Number(it.rate)) });
    setEditErrors({});
  };
  const submitEdit = async (id: string) => {
    if (!editDraft.name.trim()) return;
    const quantityError = validateLineNum(editDraft.quantity, 'Quantity');
    const rateError = validateRate(editDraft.rate);
    const rate = parseRate(editDraft.rate);
    if (quantityError || rateError || rate === null) { setEditErrors({ quantity: quantityError, rate: rateError }); return; }
    setEditErrors({});
    try {
      await onUpdate(id, { name: editDraft.name.trim(), quantity: num(editDraft.quantity), rate, ...(erpItems ? { description: editDraft.description?.trim() ?? '' } : {}) });
      setEditingId(null);
    } catch (err) { onError(err); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try { await onDelete(target.id); setDeleteTarget(null); }
    catch (err) { onError(err); setDeleteTarget(null); }
  };

  const columns: Column<ProcurementItemRow>[] = [
    {
      key: 'description', header: erpItems ? 'Item / description' : 'Description', kind: 'primary', size: 320, minSize: 200,
      cell: (it) => {
        if (editable && editingId === it.id) return erpItems ? <div className="space-y-2">
          <Combobox label="ERP item" value={editDraft.name || null} selectedOption={editDraft.name ? { value: editDraft.name, label: editDraft.name } : null} onChange={(name) => setEditDraft((d) => ({ ...d, name }))} loadOptions={erpItems.loadOptions} noun="ERP item" searchPlaceholder="Search item code or name…" />
          <CellInput aria-label={`Edit description for ${it.name}`} value={editDraft.description ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
        </div> : <CellInput aria-label={`Edit description for ${it.name}`} value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />;
        return <span className="font-medium">{it.name}{erpItems && it.description && <span className="mt-1 block font-normal text-muted-foreground">{it.description}</span>}</span>;
      },
    },
    { key: 'quantity', header: 'Qty', kind: 'number', align: 'num', size: 88, cell: (it) => editable && editingId === it.id ? <div className="space-y-1"><CellInput numeric aria-label={`Edit quantity for ${it.name}`} value={editDraft.quantity} onChange={(e) => { setEditDraft((d) => ({ ...d, quantity: e.target.value })); setEditErrors((p) => ({ ...p, quantity: undefined })); }} /><FieldError>{editErrors.quantity}</FieldError></div> : Number(it.quantity) },
    { key: 'rate', header: 'Unit price', kind: 'money', align: 'num', size: 150, cell: (it) => editable && editingId === it.id ? <div className="space-y-1"><CellInput numeric aria-label={`Edit unit price for ${it.name}`} ref={editRateMask.ref} value={editDraft.rate} onChange={editRateMask.onChange} /><FieldError>{editErrors.rate}</FieldError></div> : formatCurrencyAuto(Number(it.rate), currency) },
    { key: 'amount', header: 'Line total', kind: 'money', align: 'num', size: 150, cell: (it) => <span className="font-medium">{formatCurrencyAuto(editable && editingId === it.id ? num(editDraft.quantity) * num(editDraft.rate) : Number(it.amount ?? 0), currency)}</span> },
  ];
  if (editable) columns.push({ key: 'actions', header: 'Row actions', kind: 'actions', size: 150, cell: (it) => editingId === it.id ? <div className="flex gap-1"><Button size="sm" variant="primary" loading={busy} onClick={() => void submitEdit(it.id)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button></div> : <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${it.name}`} onClick={() => startEdit(it)}>Edit</Button><Button size="sm" variant="ghost" iconOnly aria-label={`Remove ${it.name}`} onClick={() => setDeleteTarget(it)}><Icon name="x" /></Button></div> });
  const columnsTotal = { amount: formatCurrencyAuto(total, currency) };
  return <Card className="mb-4" data-testid="line-items-section">
    <CardHead>Line items<span className="ml-2 text-[12.5px] font-normal text-muted-foreground">qty × unit price → line total</span></CardHead>
    <DataTable rows={items} columns={columns} rowKey={(it) => it.id} tableId="procurement-line-items" accessibleName="Line items"
      state={items.length === 0 ? 'empty' : undefined} emptyTitle={`No line items yet.${editable ? ' Add one below.' : ''}`}
      totals={[{ key: 'estimated', label: 'Estimated total', values: columnsTotal }]} />
    {editable && <CardPad>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(180px,1fr)_100px_150px_auto] sm:items-start" data-testid="line-item-add-row">
        <div>{erpItems ? <div className="space-y-2"><Combobox label="ERP item" value={draft.name || null} selectedOption={draft.name ? { value: draft.name, label: draft.name } : null} onChange={(name) => setDraft((d) => ({ ...d, name }))} loadOptions={erpItems.loadOptions} noun="ERP item" placeholder="Select or search item…" searchPlaceholder="Search item code or name…" required /><CellInput aria-label="New item description" placeholder="Describe the work or goods…" value={draft.description ?? ''} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></div> : <CellInput aria-label="New item description" placeholder="Add an item…" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />}</div>
        <div><CellInput numeric aria-label="New item quantity" placeholder="0" value={draft.quantity} onChange={(e) => { setDraft((d) => ({ ...d, quantity: e.target.value })); setAddErrors((p) => ({ ...p, quantity: undefined })); }} /><FieldError>{addErrors.quantity}</FieldError></div>
        <div><CellInput numeric aria-label="New item unit price" placeholder={`0${numberSymbols().decimal}00`} ref={addRateMask.ref} value={draft.rate} onChange={addRateMask.onChange} /><FieldError>{addErrors.rate}</FieldError></div>
        <div className="flex items-center gap-3"><span aria-label="New line total" className="tabular text-muted-foreground">{(() => { const qty = parseMoneyInputAtScale(draft.quantity, 2); const rate = parseMoneyInputAtScale(draft.rate, 2); return qty !== null && rate !== null ? formatCurrencyAuto(qty * rate, currency) : '—'; })()}</span><Button size="sm" variant="outline" aria-label="Add line item" disabled={!draft.name.trim()} loading={busy} onClick={() => void submitAdd()}><Icon name="plus" />Add</Button></div>
      </div>
    </CardPad>}
    <ConfirmDialog open={!!deleteTarget} tone="destructive" title={deleteTarget ? `Remove ${deleteTarget.name}?` : 'Remove line item?'} description="This removes the line item from the request. You can add it again while the request is a draft." confirmLabel="Remove item" loading={busy} onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} />
  </Card>;
};
LineItemsSection.displayName = 'LineItemsSection';
