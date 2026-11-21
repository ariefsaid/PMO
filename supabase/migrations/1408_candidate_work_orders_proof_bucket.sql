-- 1408_candidate_work_orders_proof_bucket.sql — #2595: private bucket for assessment proof files (FR-CWO-005, AC-CWO-014).
-- Same pattern as attendance-photos (1036): private, size and type limited, path {org}/{candidate}/{proof}/{name}.
-- Read follows the proof row's own select policy; write needs the right to work an item of that candidate.
-- Rollback: supabase/migrations/rollback/1408_candidate_work_orders_proof_bucket_down.sql.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('work-order-candidate-proofs', 'work-order-candidate-proofs', false, 10485760,
          array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

create policy storage_objects_wo_candidate_proof_read on storage.objects for select to authenticated
  using (bucket_id = 'work-order-candidate-proofs' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.work_order_candidate_proofs p where p.id::text = split_part(name, '/', 3)));

create policy storage_objects_wo_candidate_proof_write on storage.objects for insert to authenticated
  with check (bucket_id = 'work-order-candidate-proofs' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (public.wo_candidate_can_assess(split_part(name, '/', 2)::uuid)
              or exists (select 1 from public.work_order_candidate_items i join public.work_order_candidates c on c.id = i.candidate_id
                          where i.candidate_id::text = split_part(objects.name, '/', 2) and i.owner_id = (select auth.uid())
                            and c.status = 'assessing' and c.org_id = (select public.auth_org_id()))));
