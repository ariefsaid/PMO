-- 0352: an attachment row stays in a thread its owner owns on UPDATE, as the INSERT policy already requires.
-- Body = the head policy (incl. 0203's is_active_member gate) + the thread check.
-- Rollback: rollback/0352_agent_attachment_thread_update_down.sql

drop policy if exists agent_attachments_update on agent_attachments;
create policy agent_attachments_update on agent_attachments for update
  using (owner_id = auth.uid() and org_id = auth_org_id() and is_active_member())
  with check (
    owner_id = auth.uid()
    and org_id = auth_org_id()
    and storage_path = 'org/' || auth_org_id()::text || '/agent-attachments/' || id::text
    and exists (
      select 1 from agent_threads t
       where t.id = agent_attachments.thread_id
         and t.owner_id = auth.uid()
         and t.org_id = auth_org_id()
    )
    and is_active_member()
  );
