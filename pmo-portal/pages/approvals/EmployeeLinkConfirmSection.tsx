import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEmployeeLinkConfirm } from '@/src/hooks/useTimesheetApproval';
import { EmployeeLinkConfirm } from '@/src/components/timesheets/EmployeeLinkConfirm';

/**
 * P3b (OQ-TSP-10(C) — the owner ruling) — the Employee-adopt-link Admin queue. Renders nothing when
 * there is no proposed link (the common case for every org that hasn't flipped `timesheets`).
 */
export function EmployeeLinkConfirmSection() {
  const { t } = useTranslation();
  const may = usePermission();
  const { links, profiles, confirm } = useEmployeeLinkConfirm();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const profileOptions = useMemo(
    () =>
      (Array.isArray(profiles) ? profiles : []).map((profile) => ({
        value: profile.id,
        name: profile.full_name,
        email: profile.email,
      })),
    [profiles],
  );

  if (links.isError) {
    return (
      <section
        className="mb-4"
        aria-label={t('approvals.employeeLinks.title', 'Employee links awaiting confirmation')}
      >
        <h2 className="mb-2 text-control font-semibold text-muted-foreground">
          {t('approvals.employeeLinks.title', 'Employee links awaiting confirmation')}
        </h2>
        <ListState
          variant="error"
          title={t('approvals.queue.loadError', "Couldn't load {{queue}}", {
            queue: t('approvals.employeeLinks.title', 'Employee links awaiting confirmation').toLowerCase(),
          })}
          sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
          onRetry={() => {
            void links.refetch();
          }}
        />
      </section>
    );
  }

  if (links.isPending || !links.data || links.data.length === 0) return null;

  return (
    <section
      className="mb-4"
      aria-label={t('approvals.employeeLinks.title', 'Employee links awaiting confirmation')}
    >
      <h2 className="mb-2 text-control font-semibold text-muted-foreground">
        {t('approvals.employeeLinks.title', 'Employee links awaiting confirmation')}
      </h2>
      <EmployeeLinkConfirm
        links={links.data}
        profileOptions={profileOptions}
        canConfirm={may('confirm_employee_link', 'employeeLink')}
        confirmingId={confirmingId}
        onConfirm={async (link) => {
          setConfirmingId(link.id);
          try {
            await confirm.mutateAsync({ erpEmployeeId: link.id, profileId: link.profile_id! });
          } finally {
            setConfirmingId(null);
          }
        }}
      />
    </section>
  );
}
