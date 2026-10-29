-- Forward repair for existing installations; no user data or RLS policies changed.
-- Existing explicit authenticated permissions remain unchanged. Server-role DML
-- is used by trusted backend/administrative paths and must not rely on defaults.
begin;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles, public.projects, public.project_members, public.project_versions to service_role;
grant select, insert, update, delete on public.project_shares, public.share_members, public.share_submissions to service_role;
grant select, insert, update, delete on public.weather_provider_connections to service_role;
-- Private data stays unavailable to anonymous clients. Public weather catalogs
-- retain their deliberately public SELECT policies and are not in this list.
do $$
declare table_name text;
begin
 foreach table_name in array array[
  'profiles','projects','project_members','project_versions','project_shares',
  'share_members','share_submissions','project_email_aliases',
  'project_inbound_emails','project_inbound_attachments','weather_provider_connections',
  'weather_chaser_presence','ai_daily_usage','weather_license_reviews',
  'weather_product_entitlements','weather_provider_audit_events'
 ] loop
  if to_regclass('public.' || table_name) is not null then
   execute format('revoke all on public.%I from anon',table_name);
  end if;
 end loop;
end $$;
-- Preserve RPC-only presence access: coordinates must never be exposed directly.
revoke all on public.weather_chaser_presence from authenticated;
-- Parcel caching is installed only on some environments; do not create or enable it.
do $$
begin
 if to_regclass('public.parcel_cache_policy') is not null then
  revoke all on public.parcel_cache_policy from anon, authenticated;
  grant select on public.parcel_cache_policy to authenticated;
 end if;
 if to_regclass('public.project_parcel_cache') is not null then
  revoke all on public.project_parcel_cache from anon;
 end if;
end $$;
commit;
