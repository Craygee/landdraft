import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = id(1),
  limited = id(2),
  universal = id(3),
  unconfirmed = id(4),
  stranger = id(5),
  project = id(6),
  share = id(7),
  limitedMember = id(8),
  universalMember = id(9);
const universalPath = `${owner}/${project}/shares/${share}/state.json`;
const memberPath = (member) => `${owner}/${project}/shares/${share}/members/${member}/state.json`;

const migration = (name) =>
  readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

test("personalized share snapshots reach the right people only", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    insert into auth.users values
      ('${owner}','owner@example.test',now()), ('${limited}','limited@example.test',now()),
      ('${universal}','universal@example.test',now()), ('${unconfirmed}','universal@example.test',null),
      ('${stranger}','stranger@example.test',now());
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select jsonb_build_object('email', current_setting('request.jwt.claim.email',true))$$;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    create table public.project_shares(
      id uuid primary key, project_id uuid, owner_id uuid, state_path text,
      active boolean default true, updated_at timestamptz);
    create table public.share_members(
      id uuid primary key, share_id uuid references public.project_shares(id), user_id uuid,
      invited_email text, role text, active boolean default true);
    alter table public.share_members enable row level security;
    grant usage on schema public, auth, storage to authenticated, anon;
    grant select on public.share_members to authenticated;
    create function public.current_confirmed_email() returns text language sql stable security definer set search_path='' as
      $$select lower(u.email) from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null$$;
    create function public.share_access_role(requested uuid) returns text language sql stable security definer set search_path='' as
      $$select case when exists(select 1 from public.project_shares s where s.id=requested and s.owner_id=auth.uid() and s.active) then 'admin'
        else (select m.role from public.share_members m join public.project_shares s on s.id=m.share_id
          where m.share_id=requested and m.active and s.active
            and (m.user_id=auth.uid() or (m.user_id is null and lower(m.invited_email)=public.current_confirmed_email())) limit 1) end$$;
    create function public.can_access_share(r uuid) returns boolean language sql stable security definer set search_path='' as
      $$select public.share_access_role(r) is not null$$;
    create function public.can_manage_share(r uuid) returns boolean language sql stable security definer set search_path='' as
      $$select public.share_access_role(r)='admin'$$;
    create function public.can_view_project(r uuid) returns boolean language sql stable as $$select false$$;
    insert into public.project_shares(id,project_id,owner_id,state_path) values('${share}','${project}','${owner}','${universalPath}');`);
  await db.exec(await migration("202611040001_share_member_layer_scopes"));
  await db.exec(`insert into public.share_members(id,share_id,user_id,invited_email,role,layer_scope,state_path) values
    ('${limitedMember}','${share}','${limited}','limited@example.test','viewer','[]','${memberPath(limitedMember)}'),
    ('${universalMember}','${share}',null,'universal@example.test','viewer',null,null);`);

  const asUser = async (user, sql) => {
    const email = (
      await db.query("select email from auth.users where id=$1", [user])
    ).rows[0].email;
    await db.exec("begin; set local role authenticated;");
    try {
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.email',$2,true)",
        [user, email],
      );
      const { rows } = await db.query(sql);
      return rows;
    } finally {
      await db.exec("rollback");
    }
  };
  const canRead = async (user, path) =>
    (await asUser(user, `select public.can_view_project_asset('${path}') as allowed`))[0].allowed;

  // The defect this migration repairs: even the owner is denied.
  assert.equal(await canRead(owner, memberPath(limitedMember)), false);
  assert.equal(await canRead(limited, memberPath(limitedMember)), false);

  await db.exec(await migration("202611060001_fix_personalized_share_access"));

  assert.equal(await canRead(owner, memberPath(limitedMember)), true);
  assert.equal(await canRead(owner, universalPath), true);

  assert.equal(await canRead(limited, memberPath(limitedMember)), true);
  assert.equal(await canRead(limited, universalPath), false, "limited recipient sees only their copy");
  assert.equal(await canRead(limited, memberPath(universalMember)), false);

  assert.equal(await canRead(universal, universalPath), true);
  assert.equal(await canRead(universal, memberPath(limitedMember)), false);

  // Same email in the token, but not confirmed on the account.
  assert.equal(await canRead(unconfirmed, universalPath), false);
  assert.equal(await canRead(unconfirmed, memberPath(universalMember)), false);

  assert.equal(await canRead(stranger, universalPath), false);
  assert.equal(await canRead(stranger, memberPath(limitedMember)), false);

  assert.equal(await canRead(limited, "not-a-uuid/not-a-uuid/state.json"), false);

  const visible = async (user) =>
    (await asUser(user, "select id from public.share_members order by id")).map((r) => r.id);
  assert.deepEqual(await visible(owner), [limitedMember, universalMember]);
  assert.deepEqual(await visible(limited), [limitedMember]);
  assert.deepEqual(await visible(universal), [universalMember]);
  assert.deepEqual(await visible(unconfirmed), []);
  assert.deepEqual(await visible(stranger), []);

  await db.exec(`update public.project_shares set active=false where id='${share}'`);
  assert.equal(await canRead(limited, memberPath(limitedMember)), false, "closed share stays closed");
});
