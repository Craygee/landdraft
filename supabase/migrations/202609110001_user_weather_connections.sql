-- Per-user commercial weather connections. Provider credentials are encrypted by
-- the LandDraft server before they reach this table; the encryption key remains a
-- deployment secret and is never stored in Supabase or sent to the browser.

create table if not exists public.weather_provider_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null check (provider_id in ('xweather')),
  encrypted_credentials text not null check (char_length(encrypted_credentials) between 40 and 4096),
  client_id_hint text not null default '',
  status text not null default 'connected'
    check (status in ('connected', 'invalid', 'error')),
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider_id)
);

create index if not exists weather_provider_connections_updated_idx
  on public.weather_provider_connections (updated_at desc);

alter table public.weather_provider_connections enable row level security;

drop policy if exists "weather_connections_select_own" on public.weather_provider_connections;
create policy "weather_connections_select_own" on public.weather_provider_connections
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "weather_connections_insert_own" on public.weather_provider_connections;
create policy "weather_connections_insert_own" on public.weather_provider_connections
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "weather_connections_update_own" on public.weather_provider_connections;
create policy "weather_connections_update_own" on public.weather_provider_connections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "weather_connections_delete_own" on public.weather_provider_connections;
create policy "weather_connections_delete_own" on public.weather_provider_connections
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.weather_provider_connections to authenticated;
revoke all on public.weather_provider_connections from anon;

drop trigger if exists weather_provider_connections_set_updated_at
  on public.weather_provider_connections;
create trigger weather_provider_connections_set_updated_at
before update on public.weather_provider_connections
for each row execute function public.set_updated_at();

comment on table public.weather_provider_connections is
  'Encrypted, user-owned credentials for optional commercial weather providers.';
comment on column public.weather_provider_connections.encrypted_credentials is
  'AES-GCM ciphertext. The decryption key exists only in the LandDraft server environment.';

-- Explicit server access: do not depend on Supabase automatic Data API grants.
grant select, insert, update, delete on public.weather_provider_connections to service_role;
