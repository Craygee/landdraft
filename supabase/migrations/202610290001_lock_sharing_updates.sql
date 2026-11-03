-- Close privilege-escalation paths in project sharing (security review 2026-10-29).
-- 1. Submissions cannot be repointed at another project after they are created.
-- 2. Project and share admins cannot change ownership, hierarchy, snapshot paths
--    or the shared project outside the guarded functions.
-- 3. Email-based share roles require a confirmed account email, not the JWT claim.
-- Guarded functions run as SECURITY DEFINER, so the column guards below apply only
-- to direct Data API writes and SECURITY INVOKER functions.
begin;

-- Finding 3: confirmed email of the signed-in account, read from auth.users.
create or replace function public.current_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null and u.email is not null;
$$;

revoke all on function public.current_confirmed_email() from public, anon, authenticated;

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
          or (m.user_id is null and lower(m.invited_email) = public.current_confirmed_email())
        )
      order by case m.role when 'admin' then 3 when 'editor' then 2 else 1 end desc
      limit 1
    )
  end;
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
        or (m.user_id is null and lower(m.invited_email) = public.current_confirmed_email())
      )
  );
$$;

create or replace function public.claim_share_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed_email text := public.current_confirmed_email();
  claimed integer;
begin
  if auth.uid() is null or confirmed_email is null then
    return 0;
  end if;
  update public.share_members
  set user_id = auth.uid(), accepted_at = coalesce(accepted_at, now())
  where active
    and user_id is null
    and lower(invited_email) = confirmed_email;
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

-- An invitation binds immediately only to an account whose email is confirmed;
-- otherwise it waits for claim_share_invitations after confirmation.
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

  select id into matched_user
  from auth.users
  where lower(email) = normalized_email and email_confirmed_at is not null
  limit 1;

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

-- Finding 1: submissions keep their share, projects and submitter for life, and
-- the source project must be the shared project.
create or replace function public.guard_share_submission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id
    or new.share_id is distinct from old.share_id
    or new.source_project_id is distinct from old.source_project_id
    or new.copy_project_id is distinct from old.copy_project_id
    or new.submitted_by is distinct from old.submitted_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Only the status and note of a submission can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_share_submission_update() from public, anon, authenticated;

drop trigger if exists share_submissions_guard_update on public.share_submissions;
create trigger share_submissions_guard_update
before update on public.share_submissions
for each row execute function public.guard_share_submission_update();

drop policy if exists "share_submissions_insert_editor" on public.share_submissions;
create policy "share_submissions_insert_editor" on public.share_submissions
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.share_access_role(share_id) in ('editor', 'admin')
    and exists (
      select 1 from public.project_shares s
      where s.id = share_id and s.project_id = source_project_id
    )
    and exists (
      select 1 from public.projects p
      where p.id = copy_project_id and p.owner_id = auth.uid()
    )
  );

-- Finding 2: identity, ownership, hierarchy and snapshot path of a project change
-- only through create_project, set_project_parent and save_project_snapshot.
create or replace function public.guard_project_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id
    or new.owner_id is distinct from old.owner_id
    or new.created_at is distinct from old.created_at
    or new.parent_project_id is distinct from old.parent_project_id
    or new.state_path is distinct from old.state_path
  ) then
    raise exception 'This project field can only be changed through LandDraft' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_project_update() from public, anon, authenticated;

drop trigger if exists projects_guard_update on public.projects;
create trigger projects_guard_update
before update on public.projects
for each row execute function public.guard_project_update();

-- Now SECURITY DEFINER so it can set state_path past the guard. Authorization is
-- unchanged (can_admin_project), the account gate is checked explicitly, and the
-- path must be a snapshot of this project, as create_project requires.
create or replace function public.save_project_snapshot(
  p_project_id uuid,
  p_name text,
  p_state_path text,
  p_reason text
)
returns setof public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.projects;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not public.landdraft_account_allowed() then
    raise exception 'LandDraft access restricted' using errcode = '42501';
  end if;
  if p_reason not in ('manual', 'autosave', 'restored') then
    raise exception 'Invalid save reason';
  end if;
  if char_length(trim(p_name)) not between 1 and 160 then
    raise exception 'Project name must contain 1 to 160 characters';
  end if;
  select * into existing
  from public.projects
  where id = p_project_id and public.can_admin_project(id)
  for update;
  if not found then return; end if;

  if p_state_path is null
    or split_part(p_state_path, '/', 1) <> existing.owner_id::text
    or split_part(p_state_path, '/', 2) <> p_project_id::text
    or split_part(p_state_path, '/', 3) <> 'states'
    or split_part(p_state_path, '/', 4) = ''
    or position('..' in p_state_path) > 0
  then
    raise exception 'Project snapshot path is invalid' using errcode = '42501';
  end if;

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

revoke all on function public.save_project_snapshot(uuid, text, text, text) from public, anon;
grant execute on function public.save_project_snapshot(uuid, text, text, text) to authenticated;

-- Related path found while fixing finding 2: a share admin could move a share to
-- another project and become that project's admin. Shares stay on their project
-- and owner, and their snapshot must live in that share's folder.
create or replace function public.guard_project_share_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.owner_id is distinct from old.owner_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'A share cannot be moved to another project or owner' using errcode = '42501';
  end if;
  if split_part(new.state_path, '/', 1) <> new.owner_id::text
    or split_part(new.state_path, '/', 2) <> new.project_id::text
    or split_part(new.state_path, '/', 3) <> 'shares'
    or split_part(new.state_path, '/', 4) <> new.id::text
    or split_part(new.state_path, '/', 5) = ''
    or position('..' in new.state_path) > 0
  then
    raise exception 'Share snapshot path is invalid' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_project_share_write() from public, anon, authenticated;

drop trigger if exists project_shares_guard_write on public.project_shares;
create trigger project_shares_guard_write
before insert or update on public.project_shares
for each row execute function public.guard_project_share_write();

-- Members keep their share, email and inviter; role and active state stay editable.
-- user_id is bound only by invite_share_member and claim_share_invitations.
create or replace function public.guard_share_member_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id
    or new.share_id is distinct from old.share_id
    or new.user_id is distinct from old.user_id
    or new.invited_email is distinct from old.invited_email
    or new.invited_by is distinct from old.invited_by
    or new.created_at is distinct from old.created_at
    or new.accepted_at is distinct from old.accepted_at
  ) then
    raise exception 'Only the role or status of a member can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_share_member_update() from public, anon, authenticated;

drop trigger if exists share_members_guard_update on public.share_members;
create trigger share_members_guard_update
before update on public.share_members
for each row execute function public.guard_share_member_update();

-- Direct member inserts may not pre-bind an account; invitations go through
-- invite_share_member so the confirmed-email rule above applies.
drop policy if exists "share_members_insert_admin" on public.share_members;
create policy "share_members_insert_admin" on public.share_members
  for insert to authenticated
  with check (public.can_manage_share(share_id) and user_id is null and accepted_at is null);

commit;
