import React, { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { orgSwitch, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';
import { useOrgSwitch, useSetOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { FieldError, ListState, Switch } from '@/src/components/ui';

interface Props {
  setting: OrgSwitchKey;
  label: string;
  helper: string;
  /** With a title the card is its own Administration section and keeps its existing anchor id. */
  title?: string;
  id?: string;
  /** Shown only while the switch is on (for example the built-in roles seat report). */
  children?: ReactNode;
}

/** One organisation switch (#2746, ADR-0121). UX only: the switch's own server write decides (ADR-0016). */
export function OrgSwitchSetting({ setting, label, helper, title, id, children }: Props) {
  const { t } = useTranslation('administration');
  const labelId = useId();
  const helperId = useId();
  const canManage = usePermission()('manage', orgSwitch(setting).manage);
  const q = useOrgSwitch(setting);
  const m = useSetOrgSwitch(setting);
  const err = m.isError ? classifyMutationError(m.error) : null;
  const body = q.isError ? <ListState variant="error" title={t('orgSwitch.loadError', "Couldn't load this setting")} onRetry={() => void q.refetch()} />
    : q.data === undefined ? <ListState variant="loading" rows={1} />
    : (
      <>
        <label className="flex min-h-11 items-start gap-3 py-1.5 text-control">
          <Switch checked={q.data} onChange={(next) => { m.reset(); m.mutate(next); }} labelledBy={labelId} describedBy={helperId}
            disabled={!canManage || m.isPending} className="mt-0.5" />
          <span className="min-w-0">
            <span id={labelId} className="block font-medium">{label}</span>
            <span id={helperId} className="block text-muted-foreground">{helper}</span>
          </span>
        </label>
        {!canManage && <p className="mt-2 text-control text-muted-foreground">{t('orgSwitch.adminOnly', 'Only an Admin can change this.')}</p>}
        {err && <FieldError>{err.detail || err.headline}</FieldError>}
        {q.data && children}
      </>
    );
  if (!title) return <div className="max-w-md">{body}</div>;
  return (
    <section id={id} tabIndex={-1} className="scroll-mt-4 mt-6" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-group font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 max-w-md">{body}</div>
    </section>
  );
}
