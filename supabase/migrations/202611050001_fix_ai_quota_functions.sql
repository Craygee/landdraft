-- Repair the AI quota routines installed in 202609050001. COALESCE and
-- GREATEST are PostgreSQL special expressions and cannot be schema-qualified
-- with the system catalog at execution time.

create or replace function public.consume_ai_daily_quota(
  p_user_id uuid,
  p_reserved_tokens integer,
  p_user_request_limit integer,
  p_global_request_limit integer,
  p_user_token_limit integer,
  p_global_token_limit integer
)
returns table (
  allowed boolean,
  user_requests_remaining integer,
  global_requests_remaining integer,
  user_tokens_remaining bigint,
  global_tokens_remaining bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_date date := (pg_catalog.timezone('UTC', pg_catalog.now()))::date;
  current_user_requests integer := 0;
  current_global_requests integer := 0;
  current_user_tokens bigint := 0;
  current_global_tokens bigint := 0;
begin
  if p_user_id is null or
     p_reserved_tokens < 1 or p_reserved_tokens > 100000 or
     p_user_request_limit < 1 or p_global_request_limit < 1 or
     p_user_token_limit < 1 or p_global_token_limit < 1 then
    raise exception 'Invalid AI quota request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('landdraft-ai:' || quota_date::text, 0)
  );

  delete from public.ai_daily_usage where usage_date < quota_date - 90;

  select request_count, reserved_tokens
    into current_user_requests, current_user_tokens
  from public.ai_daily_usage
  where usage_date = quota_date and user_id = p_user_id;

  current_user_requests := coalesce(current_user_requests, 0);
  current_user_tokens := coalesce(current_user_tokens, 0);

  select coalesce(pg_catalog.sum(request_count), 0),
         coalesce(pg_catalog.sum(reserved_tokens), 0)
    into current_global_requests, current_global_tokens
  from public.ai_daily_usage
  where usage_date = quota_date;

  allowed :=
    current_user_requests + 1 <= p_user_request_limit and
    current_global_requests + 1 <= p_global_request_limit and
    current_user_tokens + p_reserved_tokens <= p_user_token_limit and
    current_global_tokens + p_reserved_tokens <= p_global_token_limit;

  if allowed then
    insert into public.ai_daily_usage (
      usage_date, user_id, request_count, reserved_tokens, updated_at
    ) values (
      quota_date, p_user_id, 1, p_reserved_tokens, pg_catalog.now()
    )
    on conflict (usage_date, user_id) do update
      set request_count = public.ai_daily_usage.request_count + 1,
          reserved_tokens = public.ai_daily_usage.reserved_tokens + excluded.reserved_tokens,
          updated_at = pg_catalog.now();

    current_user_requests := current_user_requests + 1;
    current_global_requests := current_global_requests + 1;
    current_user_tokens := current_user_tokens + p_reserved_tokens;
    current_global_tokens := current_global_tokens + p_reserved_tokens;
  end if;

  user_requests_remaining := greatest(p_user_request_limit - current_user_requests, 0);
  global_requests_remaining := greatest(p_global_request_limit - current_global_requests, 0);
  user_tokens_remaining := greatest(p_user_token_limit::bigint - current_user_tokens, 0);
  global_tokens_remaining := greatest(p_global_token_limit::bigint - current_global_tokens, 0);
  return next;
end;
$$;

create or replace function public.release_ai_daily_quota(
  p_user_id uuid,
  p_reserved_tokens integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_date date := (pg_catalog.timezone('UTC', pg_catalog.now()))::date;
begin
  if p_user_id is null or p_reserved_tokens < 1 or p_reserved_tokens > 100000 then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('landdraft-ai:' || quota_date::text, 0)
  );

  update public.ai_daily_usage
  set request_count = greatest(request_count - 1, 0),
      reserved_tokens = greatest(reserved_tokens - p_reserved_tokens, 0),
      updated_at = pg_catalog.now()
  where usage_date = quota_date and user_id = p_user_id;

  delete from public.ai_daily_usage
  where usage_date = quota_date and user_id = p_user_id and
        request_count = 0 and reserved_tokens = 0 and actual_tokens = 0;
end;
$$;

revoke all on function public.consume_ai_daily_quota(uuid, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_ai_daily_quota(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_daily_quota(uuid, integer, integer, integer, integer, integer)
  to service_role;
grant execute on function public.release_ai_daily_quota(uuid, integer)
  to service_role;
