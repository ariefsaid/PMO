drop function if exists public.activate_external_binding_audited(uuid, text, int, text, jsonb, uuid);
drop function if exists public.disconnect_external_integration_audited(uuid, text, uuid);
drop function if exists public.unlink_external_integration_audited(uuid, text, uuid, uuid);
drop function if exists public.link_external_project_audited(uuid, uuid, uuid, text, jsonb);
