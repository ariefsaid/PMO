import React from 'react';
import { PageHeader, StatTiles, StatusPill, Button, type StatTile } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus, projectIconColor } from '../../components/projects';

export interface ProjectDetailHeaderProps {
  project: ProjectWithRefs;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** Currency with a true minus glyph (U+2212) for negatives (number rigor). */
function signedCurrency(value: number): string {
  if (value < 0) return `−${formatCurrency(Math.abs(value))}`;
  return formatCurrency(value);
}

/**
 * Detail-page header: PageHeader (icon + name + StatusPill + meta row:
 * customer · mono code · Customer-PO ref + date) plus a 5-stat strip
 * (Contract / Committed / Actual / On-hand margin / Spend %). Margin is
 * success when positive, destructive when negative, with a true `−` glyph.
 * The proposed-vs-contract delta is omitted — the project row carries no
 * proposed value and we never fabricate one.
 */
const ProjectDetailHeader: React.FC<ProjectDetailHeaderProps> = ({ project }) => {
  const contract = project.contract_value ?? 0;
  const committed = project.budget ?? 0;
  const spent = project.spent ?? 0;
  const margin = contract - spent;
  const spendPct = contract > 0 ? Math.round((spent / contract) * 100) : 0;

  const meta = [
    project.client?.name ?? null,
    project.code ? `· ${project.code}` : null,
    project.customer_contract_ref
      ? `· PO ${project.customer_contract_ref}${project.contract_date ? ` (${fmtDate(project.contract_date)})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const tiles: StatTile[] = [
    { label: 'Contract', value: formatCurrency(contract) },
    { label: 'Committed', value: formatCurrency(committed) },
    { label: 'Actual', value: formatCurrency(spent) },
    {
      label: 'On-hand margin',
      value: signedCurrency(margin),
      tone: margin < 0 ? 'neg' : 'pos',
    },
    { label: 'Spend', value: `${spendPct}%` },
  ];

  return (
    <>
      <PageHeader
        icon={(project.name.trim().charAt(0) || '•').toUpperCase()}
        iconColor={projectIconColor()}
        name={project.name}
        status={
          <StatusPill variant={pillVariantForProjectStatus(project.status as string)}>
            {project.status}
          </StatusPill>
        }
        meta={meta || undefined}
        actions={
          <Button variant="outline" disabled title="Project editing is coming soon">
            Edit Project
          </Button>
        }
      />
      <StatTiles tiles={tiles} columns={5} className="mb-4" />
    </>
  );
};

export default ProjectDetailHeader;
