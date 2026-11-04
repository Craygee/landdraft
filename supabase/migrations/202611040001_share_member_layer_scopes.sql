begin;

-- Personalized sharing remains additive: null values continue to use the share's
-- universal layer scope and universal snapshot.
alter table public.share_members
  add column if not exists layer_scope jsonb null,
  add column if not exists state_path text null;

alter table public.share_members
  drop constraint if exists share_members_layer_scope_array;
alter table public.share_members
  add constraint share_members_layer_scope_array
  check (layer_scope is null or jsonb_typeof(layer_scope) = 'array');

-- A recipient may read only their membership row. Share administrators retain
-- the complete member list needed to manage access.
drop policy if exists "share_members_select_related" on public.share_members;
create policy "share_members_select_related" on public.share_members
  for select to authenticated
  using (
    public.can_manage_share(share_id)
    or user_id = auth.uid()
    or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create or replace function public.set_share_member_scope(
  p_member_id uuid,
  p_layer_scope jsonb,
  p_state_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.share_members;
  target_share public.project_shares;
  expected_prefix text;
begin
  select * into target from public.share_members where id = p_member_id;
  if target.id is null or not public.can_manage_share(target.share_id) then
    raise exception 'Only a map administrator can manage personalized layers'
      using errcode = '42501';
  end if;
  select * into target_share from public.project_shares where id = target.share_id;
  if p_layer_scope is null then
    if p_state_path is not null then
      raise exception 'Universal scope cannot use a personalized snapshot';
    end if;
  else
    if jsonb_typeof(p_layer_scope) <> 'array' then
      raise exception 'Personalized layer scope must be an array';
    end if;
    expected_prefix := target_share.owner_id::text || '/' || target_share.project_id::text
      || '/shares/' || target_share.id::text || '/members/' || target.id::text || '/';
    if p_state_path is null
      or p_state_path not like expected_prefix || '%'
      or position('..' in p_state_path) > 0
    then
      raise exception 'Personalized share snapshot path is invalid' using errcode = '42501';
    end if;
  end if;

  update public.share_members
  set layer_scope = p_layer_scope, state_path = p_state_path
  where id = target.id;
  update public.project_shares set updated_at = now() where id = target.share_id;
end;
$$;

revoke all on function public.set_share_member_scope(uuid, jsonb, text) from public, anon;
grant execute on function public.set_share_member_scope(uuid, jsonb, text) to authenticated;

-- Protect personalized snapshots even if another recipient learns a storage key.
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
  member_id uuid;
begin
  folders := storage.foldername(object_name);
  project_id := folders[2]::uuid;
  if folders[3] = 'shares' and array_length(folders, 1) >= 4 then
    share_id := folders[4]::uuid;
    if folders[5] = 'members' and array_length(folders, 1) >= 6 then
      member_id := folders[6]::uuid;
      return public.can_manage_share(share_id) or exists (
        select 1 from public.share_members m
        where m.id = member_id and m.share_id = share_id and m.active
          and (
            m.user_id = auth.uid()
            or lower(m.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
      );
    end if;
    return public.can_access_share(share_id);
  end if;
  return public.can_view_project(project_id);
exception when others then
  return false;
end;
$$;

revoke all on function public.can_view_project_asset(text) from public, anon;
grant execute on function public.can_view_project_asset(text) to authenticated;

commit;
