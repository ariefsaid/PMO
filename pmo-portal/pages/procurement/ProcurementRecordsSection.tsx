/**
 * ProcurementRecordsSection — the inline per-phase capture+upload+display section
 * for the four new ERP-canonical record types (PR / RFQ / PO / Payment).
 *
 * Shows:
 *   - RecordCards (dual-ID) for each existing record in each phase
 *   - ProcurementFilesSubsection per record
 *   - RecordCaptureForm (with RecordCaptureTrigger) for adding new records
 *   - ProcurementHistoryTimeline at the bottom
 *
 * Every capture/upload affordance is gated by the caller-supplied `canWrite`
 * (derived from `can('create','procFile', { realRole })` at the page level — the
 * real JWT role, never the impersonated effectiveRole). RLS is the enforcement
 * authority; this hides for clarity only (AC-PR-018, ADR-0016).
 *
 * No dead controls (FR-PR-026 honest doorway): affordances shown ↔ affordances work.
 * DESIGN.md tokens only; no raw hex/px; no horizontal bleed at 360/390.
 */
import React, { useState } from 'react';
import { Card, CardHead, CardPad } from '@/src/components/ui';
import { RecordCard } from './RecordCard';
import { RecordCaptureForm, RecordCaptureTrigger, type RecordKind } from './RecordCaptureForm';
import { ProcurementFilesSubsection } from './ProcurementFilesSubsection';
import { ProcurementHistoryTimeline } from './ProcurementHistoryTimeline';
import { useProcurementRecordMutations } from '@/src/hooks/useProcurementRecords';
import type { HistoryEvent } from '@/src/lib/db/procurementHistory';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProcurementRecordsSectionProps {
  procurementId: string;
  orgId: string;
  uploadedById: string | null;
  /** Whether write affordances (capture / upload) are shown. Caller derives from
   *  can('create','procFile',{ realRole }) — the real JWT role. */
  canWrite: boolean;

  // Loaded record arrays from the detail bundle
  purchaseRequests: Tables<'purchase_requests'>[];
  rfqs: Tables<'rfqs'>[];
  purchaseOrders: Tables<'purchase_orders'>[];
  payments: Tables<'payments'>[];

  /** Invoice rows for the Payment predecessor-FK dropdown ([PD-5]). */
  invoices?: ProcurementInvoiceRow[];

  /** Optional progression-history events (from buildProcurementHistory). */
  historyEvents?: HistoryEvent[];
}

// ---------------------------------------------------------------------------
// Phase meta
// ---------------------------------------------------------------------------

interface PhaseConfig {
  kind: RecordKind;
  heading: string;
}

const PHASES: PhaseConfig[] = [
  { kind: 'purchase_request', heading: 'Purchase Requests' },
  { kind: 'rfq', heading: 'RFQs' },
  { kind: 'purchase_order', heading: 'Purchase Orders' },
  { kind: 'payment', heading: 'Payments' },
];

// ---------------------------------------------------------------------------
// Per-phase sub-section
// ---------------------------------------------------------------------------

const PhaseCard: React.FC<{
  phase: PhaseConfig;
  records: {
    id: string;
    systemNumber: string | null;
    referenceNumber: string | null;
    date: string | null;
    amount: number | null;
    status: string;
    created_at: string;
  }[];
  canWrite: boolean;
  procurementId: string;
  orgId: string;
  uploadedById: string | null;
  invoices?: ProcurementInvoiceRow[];
  onCreate: (input: unknown) => Promise<unknown>;
}> = ({ phase, records, canWrite, procurementId, orgId, uploadedById, invoices, onCreate }) => {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <Card className="mb-3">
      <CardHead>{phase.heading}</CardHead>
      <CardPad className="flex flex-col gap-3">
        {/* Existing records */}
        {records.length > 0 ? (
          records.map((rec) => (
            <div key={rec.id}>
              <RecordCard
                systemNumber={rec.systemNumber ?? rec.id}
                referenceNumber={rec.referenceNumber}
                date={rec.date}
                amount={rec.amount ?? undefined}
                status={rec.status}
                label={phase.heading.replace(/s$/, '')}
              />
              <ProcurementFilesSubsection
                phase={phase.kind}
                parentId={rec.id}
                procurementId={procurementId}
                orgId={orgId}
                canWrite={canWrite}
                uploadedById={uploadedById}
              />
            </div>
          ))
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No {phase.heading.toLowerCase()} recorded yet.
          </p>
        )}

        {/* Capture affordance — gated by canWrite (caller derived from real JWT role) */}
        {canWrite && (
          <div className="border-t border-border/50 pt-3">
            {formOpen ? (
              <RecordCaptureForm
                kind={phase.kind}
                onCreate={onCreate}
                invoices={phase.kind === 'payment' ? invoices : undefined}
                onClose={() => setFormOpen(false)}
              />
            ) : (
              <RecordCaptureTrigger
                kind={phase.kind}
                open={formOpen}
                onOpen={() => setFormOpen(true)}
              />
            )}
          </div>
        )}
      </CardPad>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------

export const ProcurementRecordsSection: React.FC<ProcurementRecordsSectionProps> = ({
  procurementId,
  orgId,
  uploadedById,
  canWrite,
  purchaseRequests,
  rfqs,
  purchaseOrders,
  payments,
  invoices = [],
  historyEvents,
}) => {
  const mutations = useProcurementRecordMutations(procurementId);

  // Normalize each array into the shared shape PhaseCard expects
  const prRecords = purchaseRequests.map((r) => ({
    id: r.id,
    systemNumber: r.pr_number,
    referenceNumber: r.reference_number,
    date: r.date,
    amount: r.amount,
    status: r.status,
    created_at: r.created_at,
  }));

  const rfqRecords = rfqs.map((r) => ({
    id: r.id,
    systemNumber: r.rfq_number,
    referenceNumber: r.reference_number,
    date: r.date,
    amount: r.amount,
    status: r.status,
    created_at: r.created_at,
  }));

  const poRecords = purchaseOrders.map((r) => ({
    id: r.id,
    systemNumber: r.po_number,
    referenceNumber: r.reference_number,
    date: r.date,
    amount: r.amount,
    status: r.status,
    created_at: r.created_at,
  }));

  const payRecords = payments.map((r) => ({
    id: r.id,
    systemNumber: r.pay_number,
    referenceNumber: r.reference_number,
    date: r.date,
    amount: r.amount,
    status: r.status,
    created_at: r.created_at,
  }));

  return (
    <div>
      {/* Per-phase capture+display */}
      <PhaseCard
        phase={PHASES[0]}
        records={prRecords}
        canWrite={canWrite}
        procurementId={procurementId}
        orgId={orgId}
        uploadedById={uploadedById}
        onCreate={(input) => mutations.createPurchaseRequest.mutateAsync(
          input as Parameters<typeof mutations.createPurchaseRequest.mutateAsync>[0]
        )}
      />

      <PhaseCard
        phase={PHASES[1]}
        records={rfqRecords}
        canWrite={canWrite}
        procurementId={procurementId}
        orgId={orgId}
        uploadedById={uploadedById}
        onCreate={(input) => mutations.createRfq.mutateAsync(
          input as Parameters<typeof mutations.createRfq.mutateAsync>[0]
        )}
      />

      <PhaseCard
        phase={PHASES[2]}
        records={poRecords}
        canWrite={canWrite}
        procurementId={procurementId}
        orgId={orgId}
        uploadedById={uploadedById}
        onCreate={(input) => mutations.createPurchaseOrder.mutateAsync(
          input as Parameters<typeof mutations.createPurchaseOrder.mutateAsync>[0]
        )}
      />

      <PhaseCard
        phase={PHASES[3]}
        records={payRecords}
        canWrite={canWrite}
        procurementId={procurementId}
        orgId={orgId}
        uploadedById={uploadedById}
        invoices={invoices}
        onCreate={(input) => mutations.createPayment.mutateAsync(
          input as Parameters<typeof mutations.createPayment.mutateAsync>[0]
        )}
      />

      {/* Progression-history timeline */}
      {historyEvents !== undefined && (
        <Card className="mt-4">
          <CardHead>Progression history</CardHead>
          <CardPad>
            <ProcurementHistoryTimeline events={historyEvents} />
          </CardPad>
        </Card>
      )}
    </div>
  );
};

ProcurementRecordsSection.displayName = 'ProcurementRecordsSection';
