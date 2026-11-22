drop policy if exists storage_objects_wo_candidate_proof_write on storage.objects;
drop policy if exists storage_objects_wo_candidate_proof_read on storage.objects;
-- the bucket is removed once empty (Supabase refuses to drop a bucket that holds objects)
delete from storage.buckets where id = 'work-order-candidate-proofs'
  and not exists (select 1 from storage.objects o where o.bucket_id = 'work-order-candidate-proofs');
