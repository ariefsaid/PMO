import React, { useCallback, useState } from 'react';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  Combobox,
  NumberField,
  ConfirmDialog,
  type ComboboxOption,
} from '@/src/components/ui';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { formatCurrency } from '@/src/lib/format';
import type { Tables } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// QuotationsSection — the supplier-quotations register + inline-add entry +
// the Select-quote action (crud-components §9.5 / crud-procurement-new-pr.html).
// Wires the already-built createQuotation and the new select-quote RPC. Adding
// quotations is gated by the caller (canSource); selecting a quote is offered
// only while the PR is 'Vendor Quoted' (the RPC's stage), confirmed first.
//
// File attach is DEFERRED (Storage off): a visibly-disabled affordance with a
// tooltip, never a broken control. Token-pure (Card/Button/StatusPill/Combobox).
// ---------------------------------------------------------------------------

type QuotationRow = Tables<'procurement_quotations'>;

export interface QuotationsSectionProps {
  quotations: QuotationRow[];
  /** Add-quotation entry shown (sourcing role). */
  canAdd: boolean;
  /** Select-quote action offered (sourcing role AND PR is Vendor Quoted). */
  canSelect: boolean;
  onAdd: (input: { vendorId: string; totalAmount: number; receivedDate: string }) => Promise<unknown>;
  onSelect: (quotationId: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  addBusy?: boolean;
  selectBusy?: boolean;
}

export const QuotationsSection: React.FC<QuotationsSectionProps> = ({
  quotations,
  canAdd,
  canSelect,
  onAdd,
  onSelect,
  onError,
  addBusy,
  selectBusy,
}) => {
  const [adding, setAdding] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [total, setTotal] = useState('');
  const [selectTarget, setSelectTarget] = useState<QuotationRow | null>(null);

  const { data: vendorOptions } = useVendorOptions();
  const loadVendors = useCallback(
    async (): Promise<ComboboxOption[]> => vendorOptions ?? [],
    [vendorOptions],
  );

  const resetAdd = () => {
    setAdding(false);
    setVendorId(null);
    setTotal('');
  };

  const submitAdd = async () => {
    if (!vendorId || !total.trim()) return;
    try {
      await onAdd({
        vendorId,
        totalAmount: parseFloat(total.replace(/,/g, '')) || 0,
        receivedDate: new Date().toISOString().slice(0, 10),
      });
      resetAdd();
    } catch (err) {
      onError(err);
    }
  };

  const confirmSelect = async () => {
    if (!selectTarget) return;
    const target = selectTarget;
    try {
      await onSelect(target.id);
      setSelectTarget(null);
    } catch (err) {
      onError(err);
      setSelectTarget(null);
    }
  };

  return (
    <Card data-testid="quotations-section">
      <CardHead>
        Supplier quotations
        <span className="flex-1" />
        {canAdd && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="add-quotation">
            <Icon name="plus" />
            Add quotation
          </Button>
        )}
      </CardHead>

      <CardPad className="flex flex-col gap-px">
        {quotations.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">No quotations received yet.</p>
        ) : (
          quotations.map((q) => (
            <div
              key={q.id}
              className="flex items-center gap-2.5 border-b border-dashed border-border py-2.5 last:border-b-0"
            >
              <span
                aria-hidden
                className={`size-[9px] shrink-0 rounded-full ${q.is_selected ? 'bg-success' : 'bg-secondary'}`}
              />
              {q.vq_number && (
                <span className="font-mono text-[11px] text-muted-foreground">{q.vq_number}</span>
              )}
              {q.is_selected && <StatusPill variant="won">Selected</StatusPill>}
              <span className="ml-auto flex items-center gap-2.5">
                <span className="text-[13.5px] font-semibold tabular">
                  {formatCurrency(Number(q.total_amount))}
                </span>
                {canSelect && !q.is_selected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectTarget(q)}
                    aria-label={`Select quote ${q.vq_number ?? ''}`.trim()}
                  >
                    Select quote
                  </Button>
                )}
              </span>
            </div>
          ))
        )}

        {/* Inline-add quotation entry */}
        {adding && (
          <div
            className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border bg-secondary/35 p-3"
            data-testid="add-quotation-form"
          >
            <div className="min-w-[200px] flex-1">
              <Combobox
                label="Vendor"
                noun="vendor"
                required
                placeholder="Select a vendor…"
                value={vendorId}
                onChange={(v) => setVendorId(v)}
                loadOptions={loadVendors}
              />
            </div>
            <div className="w-[150px]">
              <NumberField
                label="Quoted total"
                required
                prefix="$"
                value={total}
                onChange={setTotal}
                placeholder="0.00"
              />
            </div>
            <span
              title="File upload coming soon"
              className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-input bg-secondary/50 px-2.5 text-[12.5px] text-muted-foreground"
            >
              <Icon name="doc" className="size-[14px]" />
              Attach file (coming soon)
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={resetAdd}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!vendorId || !total.trim()}
              loading={addBusy}
              onClick={() => void submitAdd()}
            >
              Add quotation
            </Button>
          </div>
        )}
      </CardPad>

      <ConfirmDialog
        open={!!selectTarget}
        tone="default"
        title="Select this quote?"
        description="The selected quote sets the purchase-request value and vendor, and advances the request to Quote Selected."
        confirmLabel="Select quote"
        loading={selectBusy}
        onConfirm={confirmSelect}
        onCancel={() => setSelectTarget(null)}
      />
    </Card>
  );
};

QuotationsSection.displayName = 'QuotationsSection';
