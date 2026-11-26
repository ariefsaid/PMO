import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, DataTable, FieldError, ReasonDialog, useToast, type Column } from '@/src/components/ui';
import { useCheckInRequests, useDecideCheckIn } from '@/src/hooks/usePhoneCheckIn';
import type { CheckInRequest } from '@/src/lib/repositories/phoneCheckIn';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay, formatNumberMax2 } from '@/src/lib/format';

/**
 * Phone check-ins that need a supervisor (#2705): outside the work area, off the roster, or without a position. Renders NOTHING
 * unless at least one request waits for the signed-in person, so an organisation that never sets an area sees no change. The database
 * decides who may decide (the configured role, else the crew's controller / a crew manager) and refuses the requester.
 */
export const CheckInRequests: React.FC = () => {
  const { t } = useTranslation('crews');
  const { toast } = useToast();
  const requests = useCheckInRequests();
  const decide = useDecideCheckIn();
  const [rejecting, setRejecting] = useState<CheckInRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = requests.data ?? [];
  if (rows.length === 0) return null;

  const outcome = (o: CheckInRequest['outcome']) => o === 'not_rostered' ? t('crews:checkIn.outcomeNotRostered', 'Not on the roster today')
    : o === 'no_position' ? t('crews:checkIn.outcomeNoPosition', 'No position') : t('crews:checkIn.outcomeOutside', 'Outside the work area');
  const run = async (r: CheckInRequest, approve: boolean, reason: string | null) => {
    setError(null);
    try {
      await decide.mutateAsync({ id: r.id, approve, reason });
      toast(approve ? t('crews:checkIn.approvedToast', 'Check-in approved') : t('crews:checkIn.rejectedToast', 'Check-in rejected'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline || t('crews:checkIn.decideFailed', 'The decision could not be saved'));
    }
  };

  const area = (r: CheckInRequest) => (r.area_lat != null && r.area_lng != null && r.area_radius_m != null
    ? t('crews:checkIn.requestArea', 'Work area: centre {{latitude}}, {{longitude}}, radius {{radius}} m',
      { latitude: r.area_lat, longitude: r.area_lng, radius: formatNumberMax2(r.area_radius_m) })
    : null);
  const columns: Column<CheckInRequest>[] = [
    { key: 'person', header: t('crews:person', 'Person'), kind: 'primary', rowHeader: true, cell: (r) => r.worker_name,
      secondaryCell: (r) => [r.work_order_title, r.crew_name].filter(Boolean).join(' · ') },
    { key: 'date', header: t('crews:date', 'Date'), kind: 'date', cell: (r) => formatDay(r.work_date) },
    { key: 'why', header: t('crews:checkIn.why', 'Why it waits'), cell: (r) => (
      <span className="flex flex-col">
        <span className="text-foreground">{outcome(r.outcome)}</span>
        {area(r) && <span className="text-muted-foreground">{area(r)}</span>}
      </span>
    ) },
    { key: 'distance', header: t('crews:checkIn.distanceHeader', 'From the area (m)'), kind: 'number',
      cell: (r) => (r.distance_m != null ? formatNumberMax2(Number(r.distance_m)) : null) },
    { key: 'hours', header: t('crews:hours', 'Hours'), kind: 'number', cell: (r) => formatNumberMax2(Number(r.hours)) },
    { key: 'decide', header: <span className="sr-only">{t('crews:decision', 'Decision')}</span>, kind: 'actions', cell: (r) => (
      <span className="inline-flex gap-2">
        <Button variant="outline" className="min-h-11 sm:min-h-0" size="sm" disabled={decide.isPending} onClick={() => setRejecting(r)}>
          {t('crews:checkIn.reject', 'Reject')}
        </Button>
        <Button variant="primary" className="min-h-11 sm:min-h-0" size="sm" disabled={decide.isPending} onClick={() => void run(r, true, null)}>
          {t('crews:checkIn.approve', 'Approve')}
        </Button>
      </span>
    ) },
  ];

  return (
    <Card seam className="mb-6 bg-waiting-surface" role="region" aria-labelledby="checkin-requests-title">
      <CardHead id="checkin-requests-title">{t('crews:checkIn.requestsTitle', 'Check-ins waiting for you')}</CardHead>
      <p className="px-4 pb-3 text-sm text-muted-foreground">{t('crews:checkIn.requestsCaption', 'Approving records their attendance')}</p>
      {error && <div className="px-4 pb-3"><FieldError>{error}</FieldError></div>}
      <DataTable<CheckInRequest> embedded rows={rows} columns={columns} rowKey={(r) => r.id} tableId="checkin-requests-table" />
      <ReasonDialog open={rejecting !== null} kind="reject" subject={t('crews:checkIn.rejectSubject', 'check-in')}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason: string) => { const r = rejecting; setRejecting(null); if (r) void run(r, false, reason); }} />
    </Card>
  );
};
