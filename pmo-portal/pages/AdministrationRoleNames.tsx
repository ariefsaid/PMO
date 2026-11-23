import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermission } from '@/src/auth/usePermission';
import { Button, Card, ListState, TextField, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { BUILT_IN_ROLES, type BuiltInRole } from '@/src/auth/builtInRoles';
import { ROLE_NAME_LOCALES, ROLE_NAME_MAX, resetOrgRoleName, saveOrgRoleName, validateRoleName, type RoleNameLocale } from '@/src/lib/db/orgRoleNames';
import { ORG_ROLE_NAMES_KEY, useOrgRoleNames } from '@/src/hooks/useOrgRoleNames';

/**
 * Administration › Terminology › Role names (#2712). The Admin renames each of the 28 built-in roles in English and
 * Bahasa Indonesia. Display only: the role key, access level and stored data never change. The default shown beside each
 * field comes from the catalogue, never from the override. RLS is the write authority (ADR-0016).
 */
const LOCALE_NAME: Record<RoleNameLocale, string> = { en: 'English', id: 'Bahasa Indonesia' };

/** One role, both languages, ONE save: it saves whichever languages were changed (a blanked language goes back to its default
 *  name) and Reset returns both. */
const RoleNameCard: React.FC<{ role: BuiltInRole; current?: Partial<Record<RoleNameLocale, string>> }> = ({ role, current }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canEdit = usePermission()('edit', 'user');
  const qc = useQueryClient();
  const [names, setNames] = useState<Record<RoleNameLocale, string>>({ en: current?.en ?? '', id: current?.id ?? '' });
  useEffect(() => setNames({ en: current?.en ?? '', id: current?.id ?? '' }), [current?.en, current?.id]);
  const refresh = () => qc.invalidateQueries({ queryKey: ORG_ROLE_NAMES_KEY });
  const save = useMutation({
    mutationFn: async () => {
      for (const locale of ROLE_NAME_LOCALES) {
        if (names[locale] === (current?.[locale] ?? '')) continue;
        if (names[locale].trim() === '') { if (current?.[locale] !== undefined) await resetOrgRoleName(role.key, locale); continue; }
        await saveOrgRoleName({ roleKey: role.key, locale, name: names[locale] });
      }
    },
    onSuccess: () => {
      toast(t('administration:roleNames.saved', 'Role name saved'), undefined, 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, undefined, 'error'),
  });
  const reset = useMutation({
    mutationFn: async () => { for (const locale of ROLE_NAME_LOCALES) if (current?.[locale] !== undefined) await resetOrgRoleName(role.key, locale); },
    onSuccess: () => {
      toast(t('administration:roleNames.resetDone', 'Back to the default name'), undefined, 'success');
      return refresh();
    },
    onError: (e) => toast(classifyMutationError(e).headline, undefined, 'error'),
  });
  const dirty = ROLE_NAME_LOCALES.some((l) => names[l] !== (current?.[l] ?? ''));
  const invalid = ROLE_NAME_LOCALES.some((l) => names[l].trim() !== '' && validateRoleName({ roleKey: role.key, locale: l, name: names[l] }) !== null);
  const hasOverride = ROLE_NAME_LOCALES.some((l) => current?.[l] !== undefined);
  return (
    <Card className="space-y-3 p-4" data-testid={`role-name-card-${role.key}`}>
      <h3 className="text-base font-semibold">{role.nameEn}</h3>
      {ROLE_NAME_LOCALES.map((locale) => {
        const fallback = locale === 'id' ? role.nameId : role.nameEn;
        return (
          <div key={locale} className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr] sm:items-end" data-testid={`role-name-row-${role.key}-${locale}`}>
            <div className="text-sm text-text-secondary">
              {LOCALE_NAME[locale]} · {t('administration:terminology.default', 'Default')}: {fallback}
            </div>
            <TextField label={t('administration:roleNames.name', 'Name')} disabled={!canEdit} value={names[locale]} placeholder={fallback}
              maxLength={ROLE_NAME_MAX} onChange={(v) => setNames((n) => ({ ...n, [locale]: v }))} fullWidth />
          </div>
        );
      })}
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="primary" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
            {t('administration:terminology.save', 'Save')}
          </Button>
          <Button variant="outline" disabled={!hasOverride || reset.isPending} onClick={() => reset.mutate()}>
            {t('administration:terminology.reset', 'Reset')}
          </Button>
        </div>
      )}
    </Card>
  );
};

const AdministrationRoleNames: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useOrgRoleNames();
  return (
    <section className="min-w-0 space-y-4" data-testid="administration-role-names">
      <h2 className="text-lg font-semibold">{t('administration:roleNames.title', 'Role names')}</h2>
      <p className="text-sm text-text-secondary">
        {t('administration:roleNames.intro', 'Rename the built-in roles to match your organisation. Only the displayed name changes; what each role can do stays the same.')}
      </p>
      {isLoading ? <ListState variant="loading" /> : null}
      {isError ? <ListState variant="error" onRetry={() => void refetch()} /> : null}
      {!isLoading && !isError
        ? BUILT_IN_ROLES.map((role) => (
            <RoleNameCard key={role.key} role={role} current={{ en: data?.en?.[role.key], id: data?.id?.[role.key] }} />
          ))
        : null}
    </section>
  );
};

export default AdministrationRoleNames;
