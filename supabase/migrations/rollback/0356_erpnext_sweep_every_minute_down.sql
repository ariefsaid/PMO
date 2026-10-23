-- Down for 0356: restore the five-minute erpnext-sweep schedule from 0102. Roll this back before or
-- together with 0357/0358: their backoff and hourly marker assume the one-minute tick, never the reverse.
select cron.schedule('erpnext-sweep-tick', '*/5 * * * *', 'select public.erpnext_sweep_tick()');
