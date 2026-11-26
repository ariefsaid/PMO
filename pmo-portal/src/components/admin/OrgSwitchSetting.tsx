import { useSettingsSaveEntry } from './settingsSaveContext';
import React, { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { orgSwitch, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';
import { useOrgSwitch, useSetOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { FieldError, ListState } from '@/src/components/ui';
import { SettingSwitch } from './SettingSwitch';

interface Props {
  setting: OrgSwitchKey;
  deferSave?: boolean;
  controlPosition?: 'start' | 'end';
  label: string;
  helper: string;
  /** With a title the card is its own Administration section and keeps its existing anchor id. */
  title?: string;
  id?: string;
  /** Shown only while the switch is on (for example the built-in roles seat report). */
  children?: ReactNode;
}

/** One organisation switch (#2746, ADR-0121). UX only: the switch's own server write decides (ADR-0016). */
export function OrgSwitchSetting({ setting, label, helper, title, id, children, deferSave = false, controlPosition }: Props) {
  const { t } = useTranslation('administration');
  const canManage = usePermission()('manage', orgSwitch(setting).manage);
  const q = useOrgSwitch(setting);
  const m = useSetOrgSwitch(setting);
  const [draft, setDraft] = React.useState<boolean | null>(null);
  const pageSave = useSettingsSaveEntry(deferSave && canManage ? { dirty: draft !== null && draft !== q.data, busy: m.isPending, save: async () => { if (draft !== null) { await m.mutateAsync(draft); setDraft(null); } } } : null);
  const err = m.isError ? classifyMutationError(m.error) : null;
  const body = q.isError ? <ListState variant="error" title={t('orgSwitch.loadError', "Couldn't load this setting")} onRetry={() => void q.refetch()} />
    : q.data === undefined ? <ListState variant="loading" rows={1} />
    : (
      <>
        <SettingSwitch label={label} consequence={helper} controlPosition={controlPosition} checked={draft ?? q.data} onChange={(next) => { m.reset(); if (deferSave && pageSave) setDraft(next); else m.mutate(next); }}
          disabled={!canManage || m.isPending} />
        {!canManage && <p className="mt-2 text-control text-muted-foreground">{t('orgSwitch.adminOnly', 'Only an Admin can change this.')}</p>}
        {err && <FieldError>{err.detail || err.headline}</FieldError>}
        {q.data && children}
      </>
    );
  if (!title) return <div className="max-w-xl">{body}</div>;
  return (
    <section id={id} tabIndex={-1} className="scroll-mt-4 mt-6" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-group font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 max-w-xl">{body}</div>
    </section>
  );
}
