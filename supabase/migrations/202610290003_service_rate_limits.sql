-- Durable fixed-window rate limits for Edge Functions (security review 2026-10-29):
-- place searches that skip the AI quota and outbound share invitations. Only the
-- server may consume a limit; browser clients have no access to the counters.
begin;

create table if not exists public.service_rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (bucket, window_start)
);

create index if not exists service_rate_limits_window_idx
  on public.service_rate_limits (window_start);

alter table public.service_rate_limits enable row level security;
revoke all on table public.service_rate_limits from public, anon, authenticated, service_role;

-- Counts one request against p_bucket and returns whether it fits within
-- p_limit requests per p_window_seconds. Rejected requests are not counted.
create or replace function public.consume_service_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_begin timestamptz;
  used integer;
begin
  if p_bucket is null or char_length(p_bucket) not between 1 and 200
     or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 604800 then
    raise exception 'Invalid rate limit request' using errcode = '22023';
  end if;

  window_begin := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds
  );

  delete from public.service_rate_limits
  where (bucket = p_bucket and window_start < window_begin)
     or window_start < pg_catalog.now() - interval '8 days';

  insert into public.service_rate_limits (bucket, window_start, request_count)
  values (p_bucket, window_begin, 1)
  on conflict (bucket, window_start) do update
    set request_count = public.service_rate_limits.request_count + 1
    where public.service_rate_limits.request_count < p_limit
  returning request_count into used;

  return used is not null;
end;
$$;

revoke all on function public.consume_service_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_service_rate_limit(text, integer, integer)
  to service_role;

commit;
