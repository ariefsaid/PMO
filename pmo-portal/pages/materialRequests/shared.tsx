import React from 'react';
import { StatusPill, type StatusVariant } from '@/src/components/ui';
import type { MaterialRequestStatus, StepStatus } from '@/src/lib/repositories/materialRequests';
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

