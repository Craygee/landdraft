-- Repair personalized share access from 202611040001.
-- 1. can_view_project_asset named variables after columns, so its member branch
--    raised "ambiguous column" and the catch-all handler returned false. Every
--    read of a personalized snapshot was denied, including the share admin's.
-- 2. Unbound invitations match the account's confirmed email, not the JWT claim,
--    as share_access_role has required since 202610290001.
-- 3. A recipient limited to a personalized snapshot cannot read the universal one.
begin;

-- current_confirmed_email is not executable by authenticated, and policies run as
-- the caller. This reveals only whether a member row belongs to the caller.
create or replace function public.is_share_member_caller(
  p_user_id uuid,
  p_invited_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_user_id = auth.uid()
    or (p_user_id is null and lower(p_invited_email) = public.current_confirmed_email()),
    false
  );
$$;

revoke all on function public.is_share_member_caller(uuid, text) from public, anon;
grant execute on function public.is_share_member_caller(uuid, text) to authenticated;

drop policy if exists "share_members_select_related" on public.share_members;
create policy "share_members_select_related" on public.share_members
  for select to authenticated
  using (
    public.can_manage_share(share_id)
    or public.is_share_member_caller(user_id, invited_email)
  );

create or replace function public.can_view_project_asset(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folders text[];
  v_project_id uuid;
  v_share_id uuid;
  v_member_id uuid;
begin
  folders := storage.foldername(object_name);
  v_project_id := folders[2]::uuid;
  if folders[3] = 'shares' and array_length(folders, 1) >= 4 then
    v_share_id := folders[4]::uuid;
    if public.can_manage_share(v_share_id) then
      return true;
    end if;
    if folders[5] = 'members' and array_length(folders, 1) >= 6 then
      v_member_id := folders[6]::uuid;
      return exists (
        select 1
        from public.share_members m
        join public.project_shares s on s.id = m.share_id
        where m.id = v_member_id and m.share_id = v_share_id
          and m.active and s.active
          and public.is_share_member_caller(m.user_id, m.invited_email)
      );
    end if;
    return public.can_access_share(v_share_id) and not exists (
      select 1
      from public.share_members m
      where m.share_id = v_share_id and m.active and m.state_path is not null
        and public.is_share_member_caller(m.user_id, m.invited_email)
    );
  end if;
  return public.can_view_project(v_project_id);
-- Only a malformed path means "no access". Other errors must surface, because a
-- catch-all here is what hid the bug above.
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.can_view_project_asset(text) from public, anon;
grant execute on function public.can_view_project_asset(text) to authenticated;

commit;
