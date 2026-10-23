-- Down for 0356: restore the five-minute erpnext-sweep schedule from 0102.
select cron.schedule('erpnext-sweep-tick', '*/5 * * * *', 'select public.erpnext_sweep_tick()');
