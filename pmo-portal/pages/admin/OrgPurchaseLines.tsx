import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, ConfirmDialog, FieldError, ListState, TextField } from '@/src/components/ui';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import {
  archivePurchaseLineCategory, getPurchaseLinePlanning, listPurchaseLineCategories, savePurchaseLineCategory,
  type PurchaseLineCategory,
} from '@/src/lib/db/procurementLinePlanning';
import { LINE_CATEGORIES_KEY, LINE_PLANNING_KEY } from '@/src/hooks/usePurchaseLinePlanning';

/**
 * #2696 (FR-PLP-003/004) — Administration: keep the organisation's list of line categories. Line planning is on for everyone (#2746) and
 * hidden with the Purchasing extras module.
 * Anyone who can open Administration sees it; only an Admin changes it. UX gate only — the RPCs are the authority.
 */
export default function OrgPurchaseLines() {
  const { t } = useTranslation('procurement');
  const orgId = useAuth().currentUser?.org_id;
  const canManage = usePermission()('manage', 'orgAccounting');
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [retiring, setRetiring] = useState<PurchaseLineCategory | null>(null);

  const planningKey = [LINE_PLANNING_KEY, orgId];
  const categoriesKey = [LINE_CATEGORIES_KEY, orgId];
  const planning = useQuery({ queryKey: planningKey, queryFn: getPurchaseLinePlanning, enabled: Boolean(orgId), ...SESSION_QUERY_OPTIONS });
  const categories = useQuery({ queryKey: categoriesKey, queryFn: () => listPurchaseLineCategories(), enabled: Boolean(orgId) && planning.data === true, ...SESSION_QUERY_OPTIONS });

  const save = useMutation({
    mutationFn: (v: { id: string | null; name: string }) => savePurchaseLineCategory(v.id, v.name),
    onSuccess: () => { setNewName(''); setRenaming(null); void qc.invalidateQueries({ queryKey: categoriesKey }); },
  });
  const retire = useMutation({
    mutationFn: (id: string) => archivePurchaseLineCategory(id),
    onSuccess: () => { setRetiring(null); void qc.invalidateQueries({ queryKey: categoriesKey }); },
  });
  const failure = [save, retire].find((m) => m.isError);
  const error = failure ? classifyMutationError(failure.error) : null;
  const busy = save.isPending || retire.isPending;
  const active = (categories.data ?? []).filter((c) => !c.archived_at);

  return (
    <section aria-labelledby="line-planning-heading">
      <h2 id="line-planning-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">{t('linePlanning.heading', 'Line planning')}</h2>
      <div className="mt-3 max-w-md space-y-3">
        {planning.isError ? <ListState variant="error" title={t('linePlanning.loadError', 'Couldn’t load line planning')} onRetry={() => void planning.refetch()} />
          : planning.isPending ? <ListState variant="loading" rows={2} />
          : (
            <>
              <p className="text-control text-muted-foreground">{t('linePlanning.intro', 'Each request line can carry a category and the date it is needed.')}</p>
              {planning.data === true && (
                <div className="space-y-2" data-testid="line-category-list">
                  <h3 className="text-control font-semibold">{t('linePlanning.categories', 'Categories')}</h3>
                  {categories.isError ? <ListState variant="error" title={t('linePlanning.loadError', 'Couldn’t load line planning')} onRetry={() => void categories.refetch()} />
                    : categories.isPending ? <ListState variant="loading" rows={2} />
                    : active.length === 0 ? <p className="text-control text-muted-foreground">{t('linePlanning.noCategories', 'No categories yet.')}</p>
                    : (
                      <ul className="divide-y divide-border">
                        {active.map((c) => (
                          <li key={c.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1.5">
                            {renaming?.id === c.id ? (
                              <>
                                <div className="min-w-0 flex-1">
                                  <TextField label={t('linePlanning.categoryName', 'Category name')} hideLabel value={renaming.name} onChange={(name) => setRenaming({ id: c.id, name })} maxLength={60} fullWidth />
                                </div>
                                <Button size="sm" variant="primary" disabled={busy || !renaming.name.trim()} onClick={() => save.mutate({ id: c.id, name: renaming.name })}>{t('linePlanning.save', 'Save')}</Button>
                              </>
                            ) : (
                              <>
                                <span className="min-w-0 flex-1 break-words text-control">{c.name}</span>
                                {canManage && (
                                  <>
                                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setRenaming({ id: c.id, name: c.name })}>{t('linePlanning.rename', 'Rename')}</Button>
                                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setRetiring(c)}>{t('linePlanning.retire', 'Retire')}</Button>
                                  </>
                                )}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  {canManage && (
                    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) save.mutate({ id: null, name: newName }); }}>
                      <div className="min-w-0 flex-1">
                        <TextField label={t('linePlanning.categoryName', 'Category name')} value={newName} onChange={setNewName} maxLength={60} fullWidth />
                      </div>
                      <Button type="submit" size="sm" variant="outline" disabled={busy || !newName.trim()}>{t('linePlanning.addCategory', 'Add category')}</Button>
                    </form>
                  )}
                </div>
              )}
            </>
          )}
        {!canManage && <p className="text-control text-muted-foreground">{t('linePlanning.onlyAdmin', 'Only an Admin can change this.')}</p>}
        {error && <FieldError>{error.detail || error.headline}</FieldError>}
      </div>
      <ConfirmDialog
        open={retiring !== null}
        title={t('linePlanning.retireTitle', 'Retire this category?')}
        description={t('linePlanning.retireBody', 'It stays on lines that already carry it and can no longer be chosen.')}
        confirmLabel={t('linePlanning.retireConfirm', 'Retire category')}
        tone="destructive"
        loading={retire.isPending}
        onConfirm={() => { if (retiring) retire.mutate(retiring.id); }}
        onCancel={() => setRetiring(null)}
      />
    </section>
  );
}
