create function public.zzz_sweep_probe() returns void language plpgsql security definer as $f$ begin
  -- perform public.assert_not_light();
  null; end $f$;
grant execute on function public.zzz_sweep_probe() to authenticated;
