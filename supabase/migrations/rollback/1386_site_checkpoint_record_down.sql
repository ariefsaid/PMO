-- Rollback of 1386_site_checkpoint_record.sql. Photos of the checkpoint bucket are deleted: recorded evidence is lost.
drop policy if exists storage_objects_site_checkpoint_photo_write on storage.objects;
drop policy if exists storage_objects_site_checkpoint_photo_read on storage.objects;
delete from storage.objects where bucket_id = 'site-checkpoint-photos';
delete from storage.buckets where id = 'site-checkpoint-photos';
drop trigger if exists site_checkpoints_keep_record on public.site_checkpoints;
drop function if exists public.site_checkpoints_keep_record();
drop function if exists public.record_site_checkpoint(uuid, text, text);
drop function if exists public.site_checkpoint_photo_path_ok(text, boolean);
drop function if exists public.site_checkpoint_photo_stored(text);
