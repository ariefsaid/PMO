import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, TextField, ListState, FieldError, useToast } from '@/src/components/ui';

const ITEM_QUERY_KEY = 'org-down-payment-item';

/** #766 / ADR-0077 — the ERPNext item used to bill and recover down payments. Its Item Default income account
 *  must be the customer-advance (liability) account; PMO cannot see that, so the helper says it. */
export default function OrgDownPaymentItem() {
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const queryKey = [ITEM_QUERY_KEY, currentUser?.org_id];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getDownPaymentItem(), enabled: !!currentUser });
  useEffect(() => { if (query.isSuccess) setDraft(query.data ?? ''); }, [query.data, query.isSuccess]);
  const mutation = useMutation({ mutationFn: (value: string | null) => repositories.orgSettings.setDownPaymentItem(value),
    onSuccess: () => { void qc.invalidateQueries({ queryKey }); toast('Down payment item saved', undefined, 'success'); },
    onError: (err) => { const classified = classifyMutationError(err); setError(classified.detail || classified.headline); },
  });
  return <section aria-labelledby="down-payment-item-heading">
    <h2 id="down-payment-item-heading" className="text-[15px] font-semibold">Down payments</h2>
    <p className="mt-1 text-[13px] text-muted-foreground">The ERPNext item used to bill a down payment and to recover it from billing claims. In ERPNext its income account must be the customer-advance account, or down payments will book as revenue.</p>
    <div className="mt-3 max-w-md">
      {query.isError ? <ListState variant="error" title="Couldn't load the down payment item" onRetry={() => void query.refetch()} />
        : query.isPending ? <ListState variant="loading" rows={1} />
        : canManage ? <form onSubmit={(event) => { event.preventDefault(); setError(undefined); mutation.mutate(draft.trim() || null); }} className="space-y-3">
          <TextField label="Down payment item" value={draft} onChange={setDraft} maxLength={140}
            disabled={mutation.isPending} helper="Enter the exact ERPNext item code. Leave blank to turn down payment billing off." />
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" variant="outline" disabled={mutation.isPending || draft.trim() === (query.data ?? '')}>Save item</Button>
        </form> : <p className="text-[13px]">{query.data ?? 'Not configured'}<span className="ml-2 text-muted-foreground">Only an Admin can change this.</span></p>}
    </div>
  </section>;
}
