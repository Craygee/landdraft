-- Storm Chaser presence RPCs are SECURITY DEFINER, so the restrictive
-- landdraft_weather_gate policy on weather_chaser_presence never applies to them.
-- Check the weather.core entitlement inside each function (security review 2026-10-29).
begin;

create or replace function public.upsert_weather_chaser_presence(
  p_display_name text,
  p_latitude double precision,
  p_longitude double precision,
  p_heading_deg real default null,
  p_speed_mps real default null,
  p_accuracy_m real default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  safe_name text := left(trim(coalesce(p_display_name, '')), 80);
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not public.landdraft_module_allowed('weather.core') then
    raise exception 'LandDraft Weather access is required' using errcode = '42501';
  end if;
  if safe_name = '' then safe_name := 'LandDraft chaser'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
     or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid coordinates are required' using errcode = '22023';
  end if;
  if p_heading_deg is not null and (p_heading_deg < 0 or p_heading_deg > 360) then
    raise exception 'Heading must be between 0 and 360' using errcode = '22023';
  end if;
  if p_speed_mps is not null and (p_speed_mps < 0 or p_speed_mps > 150) then
    raise exception 'Speed is outside the accepted range' using errcode = '22023';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 100000) then
    raise exception 'Accuracy is outside the accepted range' using errcode = '22023';
  end if;

  insert into public.weather_chaser_presence (
    user_id, display_name, latitude, longitude, heading_deg, speed_mps,
    accuracy_m, observed_at, expires_at, updated_at
  ) values (
    current_user_id, safe_name, p_latitude, p_longitude, p_heading_deg,
    p_speed_mps, p_accuracy_m, now(), now() + interval '10 minutes', now()
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    heading_deg = excluded.heading_deg,
    speed_mps = excluded.speed_mps,
    accuracy_m = excluded.accuracy_m,
    observed_at = excluded.observed_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.list_active_weather_chasers(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 800
)
returns table (
  presence_id uuid,
  display_name text,
  latitude double precision,
  longitude double precision,
  heading_deg real,
  speed_mps real,
  accuracy_m real,
  observed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not public.landdraft_module_allowed('weather.core') then
    raise exception 'LandDraft Weather access is required' using errcode = '42501';
  end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
     or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid coordinates are required' using errcode = '22023';
  end if;

  return query
  select
    presence.presence_id,
    presence.display_name,
    presence.latitude,
    presence.longitude,
    presence.heading_deg,
    presence.speed_mps,
    presence.accuracy_m,
    presence.observed_at
  from public.weather_chaser_presence presence
  where presence.expires_at > now()
    and 6371 * acos(least(1, greatest(-1,
      sin(radians(p_latitude)) * sin(radians(presence.latitude)) +
      cos(radians(p_latitude)) * cos(radians(presence.latitude)) *
      cos(radians(presence.longitude - p_longitude))
    ))) <= least(greatest(coalesce(p_radius_km, 800), 1), 2000)
  order by presence.observed_at desc
  limit 500;
end;
$$;

revoke all on function public.upsert_weather_chaser_presence(text, double precision, double precision, real, real, real) from public, anon;
revoke all on function public.list_active_weather_chasers(double precision, double precision, double precision) from public, anon;
grant execute on function public.upsert_weather_chaser_presence(text, double precision, double precision, real, real, real) to authenticated;
grant execute on function public.list_active_weather_chasers(double precision, double precision, double precision) to authenticated;

commit;
