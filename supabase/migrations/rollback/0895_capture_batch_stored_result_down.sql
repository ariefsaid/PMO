-- Down for 0895: drops the stored-result reader.
drop function if exists public.capture_history_batch_result(uuid,uuid,uuid,text);
