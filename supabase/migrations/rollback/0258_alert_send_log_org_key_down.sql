-- Rollback 0258_alert_send_log_org_key.sql.
-- The old error_code primary key cannot represent multiple organization-scoped records. Fail closed
-- rather than discarding an organization's cooldown record if such a collision exists.
do $$
begin
  if exists (
    select 1
      from public.alert_send_log
     group by error_code
    having count(*) > 1
  ) then
    raise exception 'Cannot roll back alert_send_log organization key: duplicate error_code rows would be lost';
  end if;
end;
$$;

drop index public.alert_send_log_error_code_idx;
alter table public.alert_send_log
  drop constraint alert_send_log_org_id_error_code_key,
  drop constraint alert_send_log_pkey,
  drop column id,
  drop column org_id,
  add constraint alert_send_log_pkey primary key (error_code);
