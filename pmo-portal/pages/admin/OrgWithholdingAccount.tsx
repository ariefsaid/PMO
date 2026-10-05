import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, TextField, ListState, FieldError, useToast } from '@/src/components/ui';

const ACCOUNT_QUERY_KEY = 'org-withholding-account';

export default function OrgWithholdingAccount() {
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const queryKey = [ACCOUNT_QUERY_KEY, currentUser?.org_id];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getWithholdingAccount(), enabled: !!currentUser });
  useEffect(() => { if (query.isSuccess) setDraft(query.data ?? ''); }, [query.data, query.isSuccess]);
  const mutation = useMutation({ mutationFn: (value: string | null) => repositories.orgSettings.setWithholdingAccount(value),
    onSuccess: () => { void qc.invalidateQueries({ queryKey }); toast('Tax-prepaid account saved', undefined, 'success'); },
    onError: (err) => { const classified = classifyMutationError(err); setError(classified.detail || classified.headline); },
  });
  return <section aria-labelledby="withholding-account-heading">
    <h2 id="withholding-account-heading" className="text-[15px] font-semibold">Receipt withholding</h2>
    <p className="mt-1 text-[13px] text-muted-foreground">The ERPNext tax-credit account for income tax withheld by clients. An Admin must configure it before a receipt with withholding can be recorded.</p>
    <div className="mt-3 max-w-md">
      {query.isError ? <ListState variant="error" title="Couldn't load the tax-prepaid account" onRetry={() => void query.refetch()} />
        : query.isPending ? <ListState variant="loading" rows={1} />
        : canManage ? <form onSubmit={(event) => { event.preventDefault(); setError(undefined); mutation.mutate(draft.trim() || null); }} className="space-y-3">
          <TextField label="Tax-prepaid account" value={draft} onChange={setDraft} maxLength={140}
            disabled={mutation.isPending} helper="Enter the exact ERPNext account name. Leave blank to disable receipt withholding." />
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" variant="outline" disabled={mutation.isPending || draft.trim() === (query.data ?? '')}>Save account</Button>
        </form> : <p className="text-[13px]">{query.data ?? 'Not configured'}<span className="ml-2 text-muted-foreground">Only an Admin can change this.</span></p>}
    </div>
  </section>;
}
