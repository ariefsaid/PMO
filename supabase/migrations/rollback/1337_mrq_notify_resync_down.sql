-- Reverses 1337_mrq_notify_resync.sql.
drop trigger if exists approval_stand_ins_notify_trg on public.approval_stand_ins;
drop trigger if exists approval_step_pins_notify_trg on public.approval_step_pins;
drop function if exists public.mrq_stand_in_notify_trg();
drop function if exists public.mrq_pin_notify_trg();
