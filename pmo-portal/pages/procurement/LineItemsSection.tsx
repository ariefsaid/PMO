import React, { useState } from 'react';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  ConfirmDialog,
} from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';

// ---------------------------------------------------------------------------
// LineItemsSection — the editable line-items table (crud-components §9.4 /
// crud-procurement-new-pr.html). Inline add-row at the foot; per-row edit +
// delete; line totals (qty × rate) derived + tabular; footer total. Editing is
// gated by the caller (requester + PM/Finance/Admin while Draft); when read-only
// the table renders static value rows with no edit chrome.
//
// Token-pure: composes Card / Button / ConfirmDialog + the DESIGN.md `input`
// shell + `tabular` numerals; no new colors or radii.
// ---------------------------------------------------------------------------

export interface ItemDraft {
  name: string;
  quantity: string;
  rate: string;
}

const EMPTY_DRAFT: ItemDraft = { name: '', quantity: '', rate: '' };

/** Parse a possibly-formatted numeric string → number (0 on empty/invalid). */
function num(v: string): number {
  const n = parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export interface LineItemsSectionProps {
  items: ProcurementItemRow[];
  /** When false, the table is read-only (no add/edit/delete chrome). */
  editable: boolean;
  /** Persisters — each rejects with a code-bearing AppError on failure. */
  onAdd: (input: { name: string; quantity: number; rate: number }) => Promise<unknown>;
  onUpdate: (id: string, patch: { name: string; quantity: number; rate: number }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  /** Mutation in-flight flags from the hook (disables the relevant control). */
  busy?: boolean;
}

/** Cell input — the small 30px `li-inp` shell from the mockup. */
const CellInput: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean }
> = ({ numeric, className = '', ...rest }) => (
  <input
    {...rest}
    type="text"
    inputMode={numeric ? 'decimal' : undefined}
    className={
      'h-[30px] w-full rounded-md border border-input bg-background px-[9px] text-[13px] text-foreground ' +
      'outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 ' +
      'focus-visible:outline-offset-1 focus-visible:outline-ring ' +
      (numeric ? 'tabular text-right ' : '') +
      className
    }
  />
);

export const LineItemsSection: React.FC<LineItemsSectionProps> = ({
  items,
  editable,
  onAdd,
  onUpdate,
  onDelete,
  onError,
  busy,
}) => {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  // The row currently being edited (id) + its working values.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState<ProcurementItemRow | null>(null);

  const total = items.reduce((sum, it) => sum + Number(it.amount ?? 0), 0);

  const submitAdd = async () => {
    if (!draft.name.trim()) return;
    try {
      await onAdd({ name: draft.name.trim(), quantity: num(draft.quantity), rate: num(draft.rate) });
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      onError(err);
    }
  };

  const startEdit = (it: ProcurementItemRow) => {
    setEditingId(it.id);
    setEditDraft({ name: it.name, quantity: String(it.quantity), rate: String(it.rate) });
  };

  const submitEdit = async (id: string) => {
    if (!editDraft.name.trim()) return;
    try {
      await onUpdate(id, {
        name: editDraft.name.trim(),
        quantity: num(editDraft.quantity),
        rate: num(editDraft.rate),
      });
      setEditingId(null);
    } catch (err) {
      onError(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await onDelete(target.id);
      setDeleteTarget(null);
    } catch (err) {
      onError(err);
      setDeleteTarget(null);
    }
  };

  return (
    <Card className="mb-4" data-testid="line-items-section">
      <CardHead>
        Line items
        <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
          qty × unit price → line total
        </span>
      </CardHead>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className="h-[38px] border-b border-border px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                Description
              </th>
              <th className="w-[88px] border-b border-border px-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                Qty
              </th>
              <th className="w-[130px] border-b border-border px-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                Unit price
              </th>
              <th className="w-[130px] border-b border-border px-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                Line total
              </th>
              {editable && (
                <th className="w-[84px] border-b border-border px-3 text-center">
                  <span className="sr-only">Row actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={editable ? 5 : 4}
                  className="px-3 py-5 text-center text-[13px] text-muted-foreground"
                >
                  No line items yet.{editable ? ' Add one below.' : ''}
                </td>
              </tr>
            )}

            {items.map((it) => {
              const isEditing = editingId === it.id;
              if (editable && isEditing) {
                return (
                  <tr key={it.id} className="border-b border-border/70">
                    <td className="px-3 py-2">
                      <CellInput
                        aria-label={`Edit description for ${it.name}`}
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CellInput
                        numeric
                        aria-label={`Edit quantity for ${it.name}`}
                        value={editDraft.quantity}
                        onChange={(e) => setEditDraft((d) => ({ ...d, quantity: e.target.value }))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CellInput
                        numeric
                        aria-label={`Edit unit price for ${it.name}`}
                        value={editDraft.rate}
                        onChange={(e) => setEditDraft((d) => ({ ...d, rate: e.target.value }))}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular font-medium">
                      {formatCurrency(num(editDraft.quantity) * num(editDraft.rate))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busy}
                          onClick={() => void submitEdit(it.id)}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={it.id} className="border-b border-border/70">
                  <td className="px-3 py-2.5 font-medium">{it.name}</td>
                  <td className="px-3 py-2.5 text-right tabular">{Number(it.quantity)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{formatCurrency(Number(it.rate))}</td>
                  <td className="px-3 py-2.5 text-right tabular font-medium">
                    {formatCurrency(Number(it.amount ?? 0))}
                  </td>
                  {editable && (
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${it.name}`}
                          onClick={() => startEdit(it)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          aria-label={`Remove ${it.name}`}
                          onClick={() => setDeleteTarget(it)}
                        >
                          <Icon name="x" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}

            {/* Inline add-row */}
            {editable && (
              <tr className="bg-secondary/35" data-testid="line-item-add-row">
                <td className="px-3 py-2">
                  <CellInput
                    aria-label="New item description"
                    placeholder="Add an item…"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <CellInput
                    numeric
                    aria-label="New item quantity"
                    placeholder="0"
                    value={draft.quantity}
                    onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <CellInput
                    numeric
                    aria-label="New item unit price"
                    placeholder="0.00"
                    value={draft.rate}
                    onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular text-muted-foreground">
                  {draft.quantity && draft.rate
                    ? formatCurrency(num(draft.quantity) * num(draft.rate))
                    : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Add line item"
                    disabled={!draft.name.trim()}
                    loading={busy}
                    onClick={() => void submitAdd()}
                  >
                    <Icon name="plus" />
                    Add
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CardPad className="flex items-center gap-3.5 border-t border-border bg-secondary/40">
        <span className="flex-1" />
        <span className="text-[12.5px] font-medium text-muted-foreground">Estimated total</span>
        <span className="text-[16px] font-bold tabular tracking-[-0.01em]">
          {formatCurrency(total)}
        </span>
      </CardPad>

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Remove ${deleteTarget.name}?` : 'Remove line item?'}
        description="This removes the line item from the request. You can add it again while the request is a draft."
        confirmLabel="Remove item"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
};

LineItemsSection.displayName = 'LineItemsSection';
