import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, FieldError, ReasonDialog, useToast } from '@/src/components/ui';
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

  return (
    <Card className="mb-4" aria-label={t('crews:checkIn.requestsTitle', 'Check-ins waiting for you')}>
      <CardHead title={t('crews:checkIn.requestsTitle', 'Check-ins waiting for you')} />
      <CardPad className="space-y-3">
        <p className="text-control text-muted-foreground">
          {t('crews:checkIn.requestsHelper', 'These people clocked in from their phone outside the work area, off the roster, or without a position. Approving records their attendance.')}
        </p>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border p-3">
              <p className="text-control font-semibold">{r.worker_name} · {r.work_order_title}</p>
              <p className="text-control text-muted-foreground">
                {formatDay(r.work_date)} · {outcome(r.outcome)}
                {r.distance_m != null && ` · ${t('crews:checkIn.distance', '{{metres}} m from the area', { metres: formatNumberMax2(Number(r.distance_m)) })}`}
                {r.crew_name && ` · ${r.crew_name}`} · {t('crews:checkIn.hours', '{{hours}} h', { hours: formatNumberMax2(Number(r.hours)) })}
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="min-h-11" disabled={decide.isPending} onClick={() => void run(r, true, null)}>
                  {t('crews:checkIn.approve', 'Approve')}
                </Button>
                <Button variant="outline" className="min-h-11" disabled={decide.isPending} onClick={() => setRejecting(r)}>
                  {t('crews:checkIn.reject', 'Reject')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {error && <FieldError>{error}</FieldError>}
      </CardPad>
      <ReasonDialog open={rejecting !== null} kind="reject" subject={t('crews:checkIn.rejectSubject', 'check-in')}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason: string) => { const r = rejecting; setRejecting(null); if (r) void run(r, false, reason); }} />
    </Card>
  );
};
