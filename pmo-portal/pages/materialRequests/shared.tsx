import React from 'react';
import { Link } from 'react-router';
import { StatusPill, type StatusVariant } from '@/src/components/ui';
import type { MaterialRequestStatus, StepStatus } from '@/src/lib/repositories/materialRequests';
import { useWorkOrder } from '@/src/hooks/useWorkOrderRecord';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useLabels } from './useMaterialRequestText';

const STATUS_VARIANT: Record<MaterialRequestStatus, StatusVariant> = {
  draft: 'draft', pending: 'progress', approved: 'won', rejected: 'lost', cancelled: 'neutral', fulfilled: 'won',
};

/** The request's status, always as a label (colour never carries it alone). */
export const RequestStatusPill: React.FC<{ status: MaterialRequestStatus }> = ({ status }) => {
  const labels = useLabels();
  return <StatusPill variant={STATUS_VARIANT[status]}>{labels.status[status]}</StatusPill>;
};

const STEP_VARIANT: Record<StepStatus, StatusVariant> = {
  waiting: 'neutral', open: 'progress', approved: 'won', returned: 'warn', rejected: 'lost', superseded: 'neutral',
};
export const StepStatusPill: React.FC<{ status: StepStatus }> = ({ status }) => {
  const labels = useLabels();
  return <StatusPill variant={STEP_VARIANT[status]}>{labels.step[status]}</StatusPill>;
};


/** The work order a request is for (number and title, linked), and optionally its project. Unreadable or still loading shows an em dash, never an id. */
export const RequestWorkOrder: React.FC<{ workOrderId: string; projectId?: string }> = ({ workOrderId, projectId }) => {
  const wo = useWorkOrder(workOrderId).data;
  const projects = useProjectPickerOptions().data;
  const project = projectId ? projects?.find((p) => p.id === projectId) : undefined;
  const label = wo ? (wo.wo_number ? `${wo.wo_number} · ${wo.title}` : wo.title) : '—';
  return (
    <>
      <Link to={`/work-orders/${workOrderId}`} className="text-primary-text hover:underline" onClick={(e) => e.stopPropagation()}>{label}</Link>
      {project && <span className="text-muted-foreground"> · {projectDisplayName(project)}</span>}
    </>
  );
};
