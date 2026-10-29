-- Secure, scoped map sharing with viewer/editor/admin roles, working-copy
-- submissions, cross-device last-opened projects, and share-specific assets.

alter table public.projects
  add column if not exists last_opened_at timestamptz not null default now();
alter table public.projects
  add column if not exists map_view jsonb not null default
    '{"center":[-98.5,31.3],"zoom":6,"bearing":0,"pitch":0}'::jsonb;

create index if not exists projects_last_opened_idx
  on public.projects (last_opened_at desc, updated_at desc);

alter table public.project_members
  drop constraint if exists project_members_role_check;
alter table public.project_members
  add constraint project_members_role_check check (role in ('viewer', 'editor', 'admin'));

create table if not exists public.project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  state_path text not null check (state_path <> ''),
  map_view jsonb not null default '{}'::jsonb,
  layer_scope jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.share_members (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.project_shares(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete cascade,
  invited_email text not null check (position('@' in invited_email) > 1),
  role text not null check (role in ('viewer', 'editor', 'admin')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  unique (share_id, invited_email)
);

create unique index if not exists share_members_user_unique
  on public.share_members (share_id, user_id) where user_id is not null;
create index if not exists share_members_user_idx
  on public.share_members (user_id, share_id) where active;
create index if not exists share_members_email_idx
  on public.share_members (lower(invited_email), share_id) where active;

create table if not exists public.share_submissions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.project_shares(id) on delete cascade,
  source_project_id uuid not null references public.projects(id) on delete cascade,
  copy_project_id uuid not null references public.projects(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'archived')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (share_id, submitted_by)
);

create index if not exists share_submissions_share_idx
  on public.share_submissions (share_id, updated_at desc);

alter table public.project_shares enable row level security;
alter table public.share_members enable row level security;
alter table public.share_submissions enable row level security;

create or replace function public.share_access_role(requested_share_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.project_shares s
      where s.id = requested_share_id and s.owner_id = auth.uid() and s.active
    ) then 'admin'
    else (
      select m.role
      from public.share_members m
      join public.project_shares s on s.id = m.share_id
      where m.share_id = requested_share_id
        and m.active and s.active
        and (
          m.user_id = auth.uid()
          or lower(m.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      order by case m.role when 'admin' then 3 when 'editor' then 2 else 1 end desc
      limit 1
    )
  end;
$$;

create or replace function public.can_access_share(requested_share_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.share_access_role(requested_share_id) is not null;
$$;

create or replace function public.can_manage_share(requested_share_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.share_access_role(requested_share_id) = 'admin';
$$;

create or replace function public.can_admin_project(requested_project_id uuid)
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
    where m.project_id = requested_project_id and m.user_id = auth.uid() and m.role = 'admin'
  ) or exists (
    select 1
    from public.project_shares s
    join public.share_members m on m.share_id = s.id
    where s.project_id = requested_project_id and s.active and m.active
      and m.role = 'admin'
      and (
        m.user_id = auth.uid()
        or lower(m.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

create or replace function public.can_view_project(requested_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_admin_project(requested_project_id)
  or exists (
    select 1 from public.project_members m
    where m.project_id = requested_project_id and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.share_submissions submission
    where submission.copy_project_id = requested_project_id
      and (
        submission.submitted_by = auth.uid()
        or public.can_manage_share(submission.share_id)
      )
  );
$$;

create or replace function public.can_view_project_asset(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folders text[];
  project_id uuid;
  share_id uuid;
begin
  folders := storage.foldername(object_name);
  project_id := folders[2]::uuid;
  if folders[3] = 'shares' and array_length(folders, 1) >= 4 then
    share_id := folders[4]::uuid;
    return public.can_access_share(share_id);
  end if;
  return public.can_view_project(project_id);
exception when others then
  return false;
end;
$$;

revoke all on function public.share_access_role(uuid) from public;
revoke all on function public.can_access_share(uuid) from public;
revoke all on function public.can_manage_share(uuid) from public;
revoke all on function public.can_admin_project(uuid) from public;
grant execute on function public.share_access_role(uuid) to authenticated;
grant execute on function public.can_access_share(uuid) to authenticated;
grant execute on function public.can_manage_share(uuid) to authenticated;
grant execute on function public.can_admin_project(uuid) to authenticated;

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_admin" on public.projects
  for update to authenticated using (public.can_admin_project(id))
  with check (public.can_admin_project(id));

drop policy if exists "versions_insert_owner" on public.project_versions;
create policy "versions_insert_admin" on public.project_versions
  for insert to authenticated
  with check (public.can_admin_project(project_id));

drop policy if exists "shares_select_authorized" on public.project_shares;
create policy "shares_select_authorized" on public.project_shares
  for select to authenticated using (public.can_access_share(id));
drop policy if exists "shares_insert_owner" on public.project_shares;
create policy "shares_insert_owner" on public.project_shares
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_admin_project(project_id));
drop policy if exists "shares_update_admin" on public.project_shares;
create policy "shares_update_admin" on public.project_shares
  for update to authenticated using (public.can_manage_share(id))
  with check (public.can_manage_share(id));
drop policy if exists "shares_delete_admin" on public.project_shares;
create policy "shares_delete_admin" on public.project_shares
  for delete to authenticated using (public.can_manage_share(id));

drop policy if exists "share_members_select_related" on public.share_members;
create policy "share_members_select_related" on public.share_members
  for select to authenticated using (public.can_access_share(share_id));
drop policy if exists "share_members_insert_admin" on public.share_members;
create policy "share_members_insert_admin" on public.share_members
  for insert to authenticated with check (public.can_manage_share(share_id));
drop policy if exists "share_members_update_admin" on public.share_members;
create policy "share_members_update_admin" on public.share_members
  for update to authenticated using (public.can_manage_share(share_id))
  with check (public.can_manage_share(share_id));
drop policy if exists "share_members_delete_admin" on public.share_members;
create policy "share_members_delete_admin" on public.share_members
  for delete to authenticated using (public.can_manage_share(share_id));

drop policy if exists "share_submissions_select_related" on public.share_submissions;
create policy "share_submissions_select_related" on public.share_submissions
  for select to authenticated
  using (submitted_by = auth.uid() or public.can_manage_share(share_id));
drop policy if exists "share_submissions_insert_editor" on public.share_submissions;
create policy "share_submissions_insert_editor" on public.share_submissions
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.share_access_role(share_id) in ('editor', 'admin')
    and exists (
      select 1 from public.projects p
      where p.id = copy_project_id and p.owner_id = auth.uid()
    )
  );
drop policy if exists "share_submissions_update_related" on public.share_submissions;
create policy "share_submissions_update_related" on public.share_submissions
  for update to authenticated
  using (submitted_by = auth.uid() or public.can_manage_share(share_id))
  with check (submitted_by = auth.uid() or public.can_manage_share(share_id));

drop policy if exists "project_assets_insert_own" on storage.objects;
create policy "project_assets_insert_admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_admin_project((storage.foldername(name))[2]::uuid)
    )
  );
drop policy if exists "project_assets_update_own" on storage.objects;
create policy "project_assets_update_admin" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-assets'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_admin_project((storage.foldername(name))[2]::uuid)
    )
  )
  with check (
    bucket_id = 'project-assets'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_admin_project((storage.foldername(name))[2]::uuid)
    )
  );
drop policy if exists "project_assets_delete_own" on storage.objects;
create policy "project_assets_delete_admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_admin_project((storage.foldername(name))[2]::uuid)
    )
  );

create or replace function public.touch_project_opened(p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.projects
  set last_opened_at = now()
  where id = p_project_id and public.can_view_project(id);
end;
$$;

create or replace function public.update_project_view(p_project_id uuid, p_map_view jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_map_view -> 'center') <> 'array'
    or jsonb_array_length(p_map_view -> 'center') <> 2
    or jsonb_typeof(p_map_view -> 'zoom') <> 'number' then
    raise exception 'Invalid map view';
  end if;
  update public.projects
  set map_view = p_map_view
  where id = p_project_id and public.can_admin_project(id);
end;
$$;

create or replace function public.invite_share_member(
  p_share_id uuid,
  p_email text,
  p_role text
)
returns setof public.share_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  matched_user uuid;
begin
  if not public.can_manage_share(p_share_id) then
    raise exception 'Only a map administrator can manage access' using errcode = '42501';
  end if;
  if p_role not in ('viewer', 'editor', 'admin') then
    raise exception 'Invalid share role';
  end if;
  if position('@' in normalized_email) <= 1 then
    raise exception 'Enter a valid email address';
  end if;

  select id into matched_user from auth.users where lower(email) = normalized_email limit 1;

  insert into public.share_members (
    share_id, user_id, invited_email, role, invited_by, accepted_at
  ) values (
    p_share_id, matched_user, normalized_email, p_role, auth.uid(),
    case when matched_user is null then null else now() end
  )
  on conflict (share_id, invited_email) do update
  set user_id = coalesce(excluded.user_id, public.share_members.user_id),
      role = excluded.role,
      active = true,
      invited_by = auth.uid(),
      accepted_at = coalesce(public.share_members.accepted_at, excluded.accepted_at);

  return query
  select * from public.share_members
  where share_id = p_share_id and invited_email = normalized_email;
end;
$$;

create or replace function public.claim_share_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed integer;
begin
  update public.share_members
  set user_id = auth.uid(), accepted_at = coalesce(accepted_at, now())
  where active
    and user_id is null
    and lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

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
  where id = p_project_id and public.can_admin_project(id)
  for update;
  if not found then return; end if;

  if p_reason = 'autosave' and existing.state_path = p_state_path then
    return query select * from public.projects where id = p_project_id;
    return;
  end if;

  insert into public.project_versions (project_id, owner_id, reason, state_path)
  values (p_project_id, existing.owner_id, p_reason, p_state_path);

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

revoke all on function public.touch_project_opened(uuid) from public;
revoke all on function public.update_project_view(uuid, jsonb) from public;
revoke all on function public.invite_share_member(uuid, text, text) from public;
revoke all on function public.claim_share_invitations() from public;
grant execute on function public.touch_project_opened(uuid) to authenticated;
grant execute on function public.update_project_view(uuid, jsonb) to authenticated;
grant execute on function public.invite_share_member(uuid, text, text) to authenticated;
grant execute on function public.claim_share_invitations() to authenticated;

drop trigger if exists project_shares_set_updated_at on public.project_shares;
create trigger project_shares_set_updated_at
before update on public.project_shares
for each row execute function public.set_updated_at();

drop trigger if exists share_submissions_set_updated_at on public.share_submissions;
create trigger share_submissions_set_updated_at
before update on public.share_submissions
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.project_shares to authenticated;
grant select, insert, update, delete on public.share_members to authenticated;
grant select, insert, update on public.share_submissions to authenticated;

-- Explicit server access: do not depend on Supabase automatic Data API grants.
grant select, insert, update, delete on public.project_shares, public.share_members, public.share_submissions to service_role;
