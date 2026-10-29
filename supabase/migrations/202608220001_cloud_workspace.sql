-- LandDraft cloud workspace: authentication profiles, cross-device projects,
-- restore history, sharing foundations, GIS support, and private file storage.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  autosave boolean not null default true,
  state_path text not null check (state_path <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('manual', 'autosave', 'restored')),
  state_path text not null check (state_path <> ''),
  saved_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_idx
  on public.projects (owner_id, updated_at desc);
create index if not exists project_members_user_idx
  on public.project_members (user_id, project_id);
create index if not exists project_versions_project_saved_idx
  on public.project_versions (project_id, saved_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_versions enable row level security;

create or replace function public.can_view_project(requested_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = requested_project_id and p.owner_id = auth.uid()
  ) or exists (
    select 1 from public.project_members m
    where m.project_id = requested_project_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.owns_project(requested_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = requested_project_id and p.owner_id = auth.uid()
  );
$$;

revoke all on function public.can_view_project(uuid) from public;
revoke all on function public.owns_project(uuid) from public;
grant execute on function public.can_view_project(uuid) to authenticated;
grant execute on function public.owns_project(uuid) to authenticated;

create or replace function public.can_view_project_asset(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  project_id uuid;
begin
  project_id := (storage.foldername(object_name))[2]::uuid;
  return public.can_view_project(project_id);
exception when others then
  return false;
end;
$$;

revoke all on function public.can_view_project_asset(text) from public;
grant execute on function public.can_view_project_asset(text) to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "projects_select_authorized" on public.projects;
create policy "projects_select_authorized" on public.projects
  for select to authenticated using (public.can_view_project(id));
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members_select_related" on public.project_members;
create policy "members_select_related" on public.project_members
  for select to authenticated
  using (user_id = auth.uid() or public.owns_project(project_id));
drop policy if exists "members_insert_by_owner" on public.project_members;
create policy "members_insert_by_owner" on public.project_members
  for insert to authenticated with check (public.owns_project(project_id));
drop policy if exists "members_update_by_owner" on public.project_members;
create policy "members_update_by_owner" on public.project_members
  for update to authenticated using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
drop policy if exists "members_delete_by_owner" on public.project_members;
create policy "members_delete_by_owner" on public.project_members
  for delete to authenticated using (public.owns_project(project_id));

drop policy if exists "versions_select_authorized" on public.project_versions;
create policy "versions_select_authorized" on public.project_versions
  for select to authenticated using (public.can_view_project(project_id));
drop policy if exists "versions_insert_owner" on public.project_versions;
create policy "versions_insert_owner" on public.project_versions
  for insert to authenticated
  with check (owner_id = auth.uid() and public.owns_project(project_id));
drop policy if exists "versions_delete_owner" on public.project_versions;
create policy "versions_delete_owner" on public.project_versions
  for delete to authenticated using (owner_id = auth.uid());

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.create_initial_project_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_versions (project_id, owner_id, reason, state_path)
  values (new.id, new.owner_id, 'manual', new.state_path);
  return new;
end;
$$;

drop trigger if exists project_initial_version on public.projects;
create trigger project_initial_version
after insert on public.projects
for each row execute function public.create_initial_project_version();

create or replace function public.save_project_snapshot(
  p_project_id uuid,
  p_name text,
  p_state_path text,
  p_reason text
)
returns setof public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.projects;
begin
  if p_reason not in ('manual', 'autosave', 'restored') then
    raise exception 'Invalid save reason';
  end if;
  if char_length(trim(p_name)) not between 1 and 160 then
    raise exception 'Project name must contain 1 to 160 characters';
  end if;
  if p_state_path is null or p_state_path = '' then
    raise exception 'Project snapshot path is required';
  end if;

  select * into existing
  from public.projects
  where id = p_project_id and owner_id = auth.uid()
  for update;
  if not found then return; end if;

  if p_reason = 'autosave' and existing.state_path = p_state_path then
    return query select * from public.projects where id = p_project_id;
    return;
  end if;

  insert into public.project_versions (project_id, owner_id, reason, state_path)
  values (p_project_id, auth.uid(), p_reason, p_state_path);

  update public.projects
  set name = trim(p_name), state_path = p_state_path
  where id = p_project_id;

  delete from public.project_versions v
  where v.project_id = p_project_id
    and v.id not in (
      select keep.id from public.project_versions keep
      where keep.project_id = p_project_id
      order by keep.saved_at desc
      limit 25
    );

  return query select * from public.projects where id = p_project_id;
end;
$$;

revoke all on function public.save_project_snapshot(uuid, text, text, text) from public;
grant execute on function public.save_project_snapshot(uuid, text, text, text) to authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, delete on public.project_versions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-assets', 'project-assets', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "project_assets_select_own" on storage.objects;
create policy "project_assets_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_view_project_asset(name)
    )
  );
drop policy if exists "project_assets_insert_own" on storage.objects;
create policy "project_assets_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "project_assets_update_own" on storage.objects;
create policy "project_assets_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "project_assets_delete_own" on storage.objects;
create policy "project_assets_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-assets' and (storage.foldername(name))[1] = auth.uid()::text);

-- Explicit server access: do not depend on Supabase automatic Data API grants.
grant select, insert, update, delete on public.profiles, public.projects, public.project_members, public.project_versions to service_role;

-- Required alongside per-object grants when rebuilding an installation.
grant usage on schema public to anon, authenticated, service_role;
