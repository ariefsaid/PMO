-- Down for 0352: restore 0060's update policy.
drop policy if exists agent_attachments_update on agent_attachments;
create policy agent_attachments_update on agent_attachments for update
  using (owner_id = auth.uid() and org_id = auth_org_id())
  with check (
    owner_id = auth.uid()
    and org_id = auth_org_id()
    and storage_path = 'org/' || auth_org_id()::text || '/agent-attachments/' || id::text
  );
