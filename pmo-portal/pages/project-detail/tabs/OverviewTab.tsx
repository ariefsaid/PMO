import React from 'react';
import { Card, CardHead, CardPad, ProgressBar } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

export interface OverviewTabProps {
  project: ProjectWithRefs;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="text-sm font-medium">{value}</dd>
  </div>
);

/**
 * REAL Overview — renders from the already-loaded `ProjectWithRefs` cache row
 * (no mockData, no fabricated team list, no task-based progress; tasks are
 * deferred). Spend progress = actual / contract (real budget figures).
 */
const OverviewTab: React.FC<OverviewTabProps> = ({ project }) => {
  const contract = project.contract_value ?? 0;
  const spent = project.spent ?? 0;
  const spendPct = contract > 0 ? Math.round((spent / contract) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHead>Project information</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <InfoRow label="Customer" value={project.client?.name ?? '—'} />
            <InfoRow label="Project manager" value={project.pm?.full_name ?? 'Unassigned'} />
            <InfoRow label="Start date" value={fmtDate(project.start_date)} />
            <InfoRow label="End date" value={fmtDate(project.end_date)} />
            <InfoRow
              label="Project code"
              value={<span className="font-mono text-[13px]">{project.code ?? '—'}</span>}
            />
            <InfoRow
              label="Customer PO ref"
              value={
                project.customer_contract_ref ? (
                  <span className="font-mono text-[13px]">{project.customer_contract_ref}</span>
                ) : (
                  '—'
                )
              }
            />
          </dl>
        </CardPad>
      </Card>

      <Card>
        <CardHead>Budget utilization</CardHead>
        <CardPad className="flex flex-col gap-3">
          <div className="text-[12px] text-muted-foreground">
            <span className="font-semibold tabular text-foreground">{formatCurrency(spent)}</span> of{' '}
            <span className="font-semibold tabular text-foreground">{formatCurrency(contract)}</span>{' '}
            contract spent
          </div>
          <ProgressBar
            value={spendPct}
            showValue
            aria-label={`Spend: ${spendPct}% of contract`}
          />
        </CardPad>
      </Card>
    </div>
  );
};

export default OverviewTab;
