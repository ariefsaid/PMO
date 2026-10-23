-- Down for 0352: restore the head update policy (0060 + 0203's is_active_member gate).
drop policy if exists agent_attachments_update on agent_attachments;
create policy agent_attachments_update on agent_attachments for update
  using (owner_id = auth.uid() and org_id = auth_org_id() and is_active_member())
  with check (
    owner_id = auth.uid()
    and org_id = auth_org_id()
    and storage_path = 'org/' || auth_org_id()::text || '/agent-attachments/' || id::text
    and is_active_member()
  );
