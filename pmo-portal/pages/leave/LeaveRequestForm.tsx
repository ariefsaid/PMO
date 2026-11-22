import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, EntityFormModal, FormGrid, SelectField, TextArea, useToast, type SubmitError } from '@/src/components/ui';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useLeaveMutations, useLeaveTypes } from '@/src/hooks/useLeave';
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { toIso } from '../equipment/equipmentWeek';
import { useLeaveErrorText } from '../crews/crewErrors';

interface Requestable { id: string; name: string; is_self: boolean }

function useRequestablePeople() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['leave-requestable', orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<Requestable[]> => {
      const rpc = (supabase as unknown as { rpc: (f: string) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> }).rpc;
      const { data, error } = await rpc.call(supabase, 'leave_requestable_people');
      if (error) throw new AppError(error.message, error.code);
      return (data ?? []) as Requestable[];
    },
  });
}

/** Request leave or report sickness (FR-LV-002): a person, a type from the organisation's list, a range, an optional reason. */
export const LeaveRequestForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('crews');
  const writeError = useLeaveErrorText();
  const { toast } = useToast();
  const people = useRequestablePeople();
  const types = useLeaveTypes();
  const { submit } = useLeaveMutations();
  const liveTypes = (types.data ?? []).filter((x) => !x.archived_at);
  const [personId, setPersonId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [start, setStart] = useState(toIso(new Date()));
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<SubmitError | null>(null);
  const effectivePerson = personId || (people.data ?? []).find((p) => p.is_self)?.id || (people.data ?? [])[0]?.id || '';
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await submit.mutateAsync({ person_id: effectivePerson, leave_type_id: typeId, start_date: start, end_date: end || start, reason: reason || null });
      toast(t('crews:leave.requested', 'Request sent'), undefined, 'success');
      onClose();
    } catch (err) {
      setError({ headline: t('crews:saveFailed', 'Not saved'), detail: writeError(err) });
    }
  };
  return (
    <EntityFormModal open title={t('crews:leave.formTitle', 'Request leave or report sickness')} submitLabel={t('crews:leave.send', 'Send request')}
      onSubmit={(e) => void send(e)} onClose={onClose} loading={submit.isPending} dirty={Boolean(typeId || reason)}
      submitDisabled={!effectivePerson || !typeId || !start} submitError={error}>
      <FormGrid>
        {(people.data ?? []).length > 1 && (
          <SelectField label={t('crews:leave.person', 'Person')} required value={effectivePerson} onChange={setPersonId}
            options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        )}
        <SelectField label={t('crews:leave.type', 'Type')} required value={typeId} onChange={setTypeId}
          placeholder={t('crews:leave.pickType', 'Choose a type')} options={liveTypes.map((x) => ({ value: x.id, label: x.name }))} />
        <DateField label={t('crews:from', 'From')} required value={start} onChange={setStart} />
        <DateField label={t('crews:leave.lastDay', 'Last day')} value={end} onChange={setEnd} min={start} />
        <TextArea label={t('crews:leave.reason', 'Reason (optional)')} value={reason} onChange={setReason} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};
