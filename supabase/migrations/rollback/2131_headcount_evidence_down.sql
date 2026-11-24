-- Reverses 2131. Data loss: the citations of documents on head counts are dropped; the documents themselves stay.
drop function if exists public.detach_headcount_document(uuid);
drop function if exists public.attach_headcount_document(uuid, uuid);
drop table if exists public.headcount_day_documents;
