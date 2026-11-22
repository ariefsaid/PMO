-- reverse 1650
update public.record_history_config set captured = captured - 'work_order_id' - 'discipline_id' where table_name = 'procurements';
