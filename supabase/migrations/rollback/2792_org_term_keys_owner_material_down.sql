-- Rollback of 2792: a rename saved under an added key is removed first (the foreign key would refuse the delete otherwise).
delete from public.org_terminology where term_key in ('stageRequested','stageSetAside','stageReceived','stageIssued','stageReturned','stageTransferred','stageClosing','materialReconciliation');
delete from public.org_term_keys where term_key in ('stageRequested','stageSetAside','stageReceived','stageIssued','stageReturned','stageTransferred','stageClosing','materialReconciliation');
